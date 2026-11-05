"""Compound alert rules: AND/OR of per-ticker conditions over a scope. Pure, no I/O.

A compound rule (kind ``compound``) watches either one ticker or the holdings
of a portfolio, optionally narrowed to sectors/industries. For each ticker in
scope every condition is checked against that ticker's readings, and the
conditions combine with AND or OR into three-valued logic: True, False, or
None when there was not enough data to decide.

Firing follows level-rule semantics *per ticker*: a ticker fires when its
combined result becomes True, stays quiet while it stays True, and re-arms
once it is False. An unknown result (None) changes nothing, so a data gap can
neither fire nor re-arm. One evaluation fires at most once, listing every
ticker that newly matched. A rule with a daily-move condition also re-arms a
ticker when a new trading session starts (keyed by the quote's previous close).

The LLM compiler (alert_compiler.py) only produces these params. Evaluation is
this module plus the engine's data fetches, with no model involved.

Readings per ticker, as the engine supplies them (missing key = not fetched):
  quote:   {"price", "change_pct", "prev_close"} | None
  ma50 / ma200: {"close", "sma", "date"} | None
  regime:  "Bull" | "Sideways" | "Bear" | None
  verdict: "buy" | "hold" | "sell" | None
  weight:  fraction of the portfolio | None
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_CONDITIONS = 5
MAX_SECTORS = 5


class PriceCondition(BaseModel):
    type: Literal["price_above", "price_below"]
    price: float = Field(gt=0)


class MoveCondition(BaseModel):
    type: Literal["daily_move"]
    pct: float = Field(gt=0, le=100)
    direction: Literal["any", "up", "down"] = "any"


class MaCondition(BaseModel):
    type: Literal["ma"]
    window: Literal[50, 200] = 200
    direction: Literal["above", "below"] = "below"


class RegimeCondition(BaseModel):
    type: Literal["regime"]
    regime: Literal["Bull", "Sideways", "Bear"]


class VerdictCondition(BaseModel):
    type: Literal["verdict"]
    verdict: Literal["buy", "hold", "sell"]

    @field_validator("verdict", mode="before")
    @classmethod
    def _lower(cls, v):
        return v.lower() if isinstance(v, str) else v


class WeightCondition(BaseModel):
    type: Literal["weight_above"]
    pct: float = Field(gt=0, le=100)


Condition = Annotated[
    Union[PriceCondition, MoveCondition, MaCondition, RegimeCondition, VerdictCondition, WeightCondition],
    Field(discriminator="type"),
]


class CompoundParams(BaseModel):
    op: Literal["and", "or"] = "and"
    conditions: list[Condition] = Field(min_length=1, max_length=MAX_CONDITIONS)
    scope: Literal["ticker", "holdings"] = "ticker"
    sectors: list[str] = Field(default_factory=list, max_length=MAX_SECTORS)

    @field_validator("sectors")
    @classmethod
    def _clean_sectors(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for s in v:
            s = " ".join(str(s).split())
            if not s:
                continue
            if len(s) > 64:
                raise ValueError("a sector name is at most 64 characters")
            if s.lower() not in (x.lower() for x in out):
                out.append(s)
        return out

    @model_validator(mode="after")
    def _scope_rules(self):
        if self.scope == "holdings":
            if any(c.type in ("price_above", "price_below") for c in self.conditions):
                raise ValueError("a price level needs a single ticker, not every holding")
        elif self.sectors:
            raise ValueError("a sector filter needs the holdings scope")
        return self


def needs_portfolio(params: dict) -> bool:
    """Holdings scope and weight conditions both read a portfolio."""
    return params.get("scope") == "holdings" or any(c.get("type") == "weight_above" for c in params.get("conditions", []))


def _norm(s: str) -> str:
    s = s.lower().replace("&", "and")
    return "".join(ch for ch in s if ch.isalnum())


def sector_matches(sector: str | None, industry: str | None, filters: list[str]) -> bool:
    """Case- and punctuation-insensitive containment either way, against sector or
    industry: "semiconductor" matches industry "Semiconductors", "Health Care"
    matches "Healthcare", "Information Technology" matches "Technology"."""
    if not filters:
        return True
    names = [_norm(x) for x in (sector, industry) if x]
    for f in filters:
        nf = _norm(f)
        if nf and any(nf in n or n in nf for n in names if n):
            return True
    return False


# ── per-condition checks ────────────────────────────────────────────────────

def reading_key(cond: dict) -> str:
    """Which reading a condition needs (the engine fetches by this key)."""
    t = cond["type"]
    if t in ("price_above", "price_below", "daily_move"):
        return "quote"
    if t == "ma":
        return f"ma{int(cond['window'])}"
    if t == "weight_above":
        return "weight"
    return t  # regime, verdict


# Cheapest first, so the engine can short-circuit before the costly ones.
FETCH_ORDER = ("weight", "verdict", "quote", "ma50", "ma200", "regime")


def _num(x: float) -> str:
    return f"{x:,.2f}" if abs(x) >= 1 else f"{x:.6g}"


def condition_label(cond: dict) -> str:
    t = cond["type"]
    if t == "price_above":
        return f"price above {_num(cond['price'])}"
    if t == "price_below":
        return f"price below {_num(cond['price'])}"
    if t == "daily_move":
        word = {"up": "up", "down": "down"}.get(cond.get("direction", "any"), "moving")
        return f"{word} {cond['pct']:g}%+ today"
    if t == "ma":
        return f"{cond['direction']} its {cond['window']}-day average"
    if t == "regime":
        return f"{cond['regime']} regime"
    if t == "verdict":
        return f"AI verdict {cond['verdict'].upper()}"
    if t == "weight_above":
        return f"over {cond['pct']:g}% of the portfolio"
    return t


def check_condition(cond: dict, readings: dict) -> tuple[bool | None, str]:
    """(result, short reading) for one condition on one ticker. None = no data."""
    key = reading_key(cond)
    r = readings.get(key)
    t = cond["type"]
    if r is None:
        return None, f"{condition_label(cond)}: no data" if key in readings else f"{condition_label(cond)}: not checked"

    if t in ("price_above", "price_below"):
        price = r.get("price")
        if price is None:
            return None, "no price"
        ok = price > cond["price"] if t == "price_above" else price < cond["price"]
        return ok, f"price {_num(price)}"

    if t == "daily_move":
        chg = r.get("change_pct")
        if chg is None:
            return None, "no change from the previous close yet"
        d = cond.get("direction", "any")
        ok = (chg >= cond["pct"]) if d == "up" else (chg <= -cond["pct"]) if d == "down" else abs(chg) >= cond["pct"]
        return ok, f"{chg:+.2f}% today"

    if t == "ma":
        close, sma = r["close"], r["sma"]
        above = close > sma
        ok = above if cond["direction"] == "above" else not above
        return ok, f"close {_num(close)} vs {cond['window']}-day {_num(sma)}"

    if t == "regime":
        return r == cond["regime"], f"regime {r}"

    if t == "verdict":
        return str(r).lower() == cond["verdict"], f"verdict {str(r).upper()}"

    if t == "weight_above":
        return r * 100 > cond["pct"], f"{r * 100:.1f}% of the portfolio"

    return None, t


def combine(op: str, results: list[bool | None]) -> bool | None:
    """Kleene AND/OR: a decisive value wins over unknowns."""
    if op == "or":
        if any(r is True for r in results):
            return True
        return False if results and all(r is False for r in results) else None
    if any(r is False for r in results):
        return False
    return True if results and all(r is True for r in results) else None


def decided(op: str, results: list[bool | None]) -> bool:
    """True once the remaining conditions can no longer change the outcome."""
    return any(r is False for r in results) if op == "and" else any(r is True for r in results)


# ── whole-rule evaluation ───────────────────────────────────────────────────

@dataclass
class CompoundResult:
    condition: bool | None
    observed: str
    state: dict
    fire: bool = False
    title: str = ""
    message: str = ""
    data: dict = field(default_factory=dict)
    matched: list[str] = field(default_factory=list)  # tickers that newly matched


def scope_label(params: dict, *, ticker: str | None, portfolio_name: str | None) -> str:
    if params.get("scope") != "holdings":
        return ticker or "?"
    where = portfolio_name or "the portfolio"
    sectors = params.get("sectors") or []
    return f"{' / '.join(sectors)} holdings in {where}" if sectors else f"holdings in {where}"


def evaluate(params: dict, observed: dict | None, prev_state: dict | None, *,
             ticker: str | None = None, portfolio_name: str | None = None) -> CompoundResult:
    """observed: {"readings": {TICKER: {key: reading}}, "excluded": [...]} or None."""
    prev = dict(prev_state or {})
    if observed is None:
        return CompoundResult(None, "No data available right now", prev)
    op = params.get("op", "and")
    conditions = params["conditions"]
    readings: dict[str, dict] = observed.get("readings") or {}
    joiner = " and " if op == "and" else " or "
    what = joiner.join(condition_label(c) for c in conditions)
    where = scope_label(params, ticker=ticker, portfolio_name=portfolio_name)
    if not readings:
        note = "No holdings match the scope" if params.get("scope") == "holdings" else "No data available right now"
        return CompoundResult(None, note, {"tickers": {}})

    prev_tickers: dict[str, dict] = (prev.get("tickers") or {})
    has_move = any(c["type"] == "daily_move" for c in conditions)
    new_tickers: dict[str, dict] = {}
    matching: list[str] = []
    newly: list[str] = []
    unknown: list[str] = []
    lines: dict[str, str] = {}

    for sym in sorted(readings):
        r = readings[sym]
        results, notes = [], []
        for c in conditions:
            ok, note = check_condition(c, r)
            results.append(ok)
            notes.append(note)
        cond = combine(op, results)
        before = dict(prev_tickers.get(sym) or {})
        if has_move:
            session = (r.get("quote") or {}).get("prev_close")
            if session is not None and before.get("session") != session:
                before = {"active": False}
            if session is not None:
                before["session"] = session
        was = bool(before.get("active"))
        if cond is None:
            unknown.append(sym)
            new_tickers[sym] = {**before, "active": was}
        else:
            new_tickers[sym] = {**before, "active": cond}
            if cond:
                matching.append(sym)
                if not was:
                    newly.append(sym)
        lines[sym] = "; ".join(n for n in notes if not n.endswith("not checked")) or "not checked"

    state = {"tickers": new_tickers}
    overall: bool | None = True if matching else (None if unknown and len(unknown) == len(readings) else False)

    if params.get("scope") == "holdings":
        n = len(readings)
        observed_txt = (f"{len(matching)} of {n} holding{'s' if n != 1 else ''} match"
                        + (f": {', '.join(matching)}" if matching else "")
                        + (f" ({len(unknown)} without data)" if unknown else ""))
    else:
        sym = next(iter(readings))
        observed_txt = lines[sym]

    excluded = observed.get("excluded") or []
    if excluded:
        observed_txt += f"; {len(excluded)} holding{'s' if len(excluded) != 1 else ''} outside the sector filter"

    if not newly:
        return CompoundResult(overall, observed_txt, state)

    names = ", ".join(newly)
    title = f"{names}: {what}"
    if len(title) > 200:
        title = title[:199] + "…"
    detail = " ".join(f"{s}: {lines[s]}." for s in newly)
    message = (f"{names} now match{'es' if len(newly) == 1 else ''} your rule ({what}, {where}). {detail}")
    return CompoundResult(
        overall, observed_txt, state, True, title, message,
        {"matched": newly, "readings": {s: lines[s] for s in newly}, "op": op},
        matched=newly,
    )
