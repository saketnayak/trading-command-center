"""Alert rule kinds: parameter validation and evaluation. Pure, no I/O.

Two families:

* Level rules (price above/below, daily move (re-armed per trading session), moving-average cross,
  portfolio drawdown, position weight) fire when their condition *becomes*
  true. While it stays true they stay quiet; once it turns false they re-arm.
  The first check counts as a transition, so a rule created while its
  condition already holds fires once.
* Change rules (Markov regime, AI verdict) record a baseline on the first
  check and fire when the observed value changes after that.

The engine (alert_engine.py) fetches the observation, calls `evaluate`,
stores the returned state and applies the per-rule cooldown.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-^=]{0,15}$")


class PriceLevelParams(BaseModel):
    price: float = Field(gt=0)


class DailyMoveParams(BaseModel):
    pct: float = Field(gt=0, le=100)


class MaCrossParams(BaseModel):
    window: Literal[50, 200] = 200
    direction: Literal["above", "below"] = "below"


class RegimeParams(BaseModel):
    to: Literal["any", "Bull", "Sideways", "Bear"] = "any"


class NoParams(BaseModel):
    pass


class PortfolioPctParams(BaseModel):
    pct: float = Field(gt=0, le=100)


@dataclass(frozen=True)
class KindSpec:
    label: str
    scope: Literal["ticker", "portfolio"]
    params: type[BaseModel]
    family: Literal["level", "change"]


KINDS: dict[str, KindSpec] = {
    "price_above": KindSpec("Price rises above", "ticker", PriceLevelParams, "level"),
    "price_below": KindSpec("Price falls below", "ticker", PriceLevelParams, "level"),
    "daily_move": KindSpec("Moves more than X% in a day", "ticker", DailyMoveParams, "level"),
    "ma_cross": KindSpec("Closes above/below its moving average", "ticker", MaCrossParams, "level"),
    "regime_change": KindSpec("Markov regime changes", "ticker", RegimeParams, "change"),
    "verdict_change": KindSpec("AI verdict changes", "ticker", NoParams, "change"),
    "portfolio_drawdown": KindSpec("Portfolio falls X% from its peak", "portfolio", PortfolioPctParams, "level"),
    "position_weight": KindSpec("A holding grows past X% of the portfolio", "portfolio", PortfolioPctParams, "level"),
}


class RuleParamError(ValueError):
    pass


def validate_params(kind: str, params: dict | None) -> dict:
    spec = KINDS.get(kind)
    if spec is None:
        raise RuleParamError(f"Unknown alert kind '{kind}'")
    try:
        return spec.params.model_validate(params or {}).model_dump()
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first.get("loc", ())) or "params"
        raise RuleParamError(f"{where}: {first.get('msg')}") from exc


@dataclass
class Evaluation:
    condition: bool | None  # None: no data this time
    observed: str  # human-readable current reading, for "check now"
    state: dict
    fire: bool = False
    title: str = ""
    message: str = ""
    data: dict = field(default_factory=dict)


def _num(x: float) -> str:
    return f"{x:,.2f}" if abs(x) >= 1 else f"{x:.6g}"


def _level(prev_state: dict | None, condition: bool, extra: dict | None = None) -> tuple[bool, dict]:
    was = bool((prev_state or {}).get("active"))
    return condition and not was, {**(extra or {}), "active": condition}


def evaluate(kind: str, params: dict, observed: dict | None, prev_state: dict | None, *,
             ticker: str | None = None, portfolio_name: str | None = None, today: date | None = None) -> Evaluation:
    prev_state = dict(prev_state or {})
    if observed is None:
        return Evaluation(None, "No data available right now", prev_state)
    t = ticker or "?"

    if kind in ("price_above", "price_below"):
        price, level = observed["price"], params["price"]
        cond = price > level if kind == "price_above" else price < level
        fire, state = _level(prev_state, cond)
        word = "above" if kind == "price_above" else "below"
        return Evaluation(
            cond, f"Last price {_num(price)} ({'is' if cond else 'not'} {word} {_num(level)})", state, fire,
            f"{t} {word} {_num(level)}",
            f"{t} is at {_num(price)}, {word} your {_num(level)} alert level.",
            {"price": price, "level": level},
        )

    if kind == "daily_move":
        chg = observed.get("change_pct")
        if chg is None:
            return Evaluation(None, "No change from the previous close yet", prev_state)
        # The session is identified by the previous close the move is measured from,
        # not the UTC date: US after-hours trading crosses UTC midnight, and a date
        # key would re-arm mid-session. A new previous close re-arms the rule.
        session = observed.get("prev_close")
        session = f"pc:{session}" if session is not None else (today or date.today()).isoformat()
        if prev_state.get("session") != session:
            prev_state = {"session": session, "active": False}
        cond = abs(chg) >= params["pct"]
        fire, state = _level(prev_state, cond, {"session": session})
        direction = "up" if chg > 0 else "down"
        return Evaluation(
            cond, f"{chg:+.2f}% today (alert at ±{params['pct']:g}%)", state, fire,
            f"{t} {direction} {abs(chg):.1f}% today",
            f"{t} is {direction} {abs(chg):.1f}% today at {_num(observed['price'])}, past your {params['pct']:g}% move alert.",
            {"change_pct": chg, "price": observed["price"]},
        )

    if kind == "ma_cross":
        close, sma, as_of = observed["close"], observed["sma"], observed.get("date")
        above = close > sma
        cond = above if params["direction"] == "above" else not above
        fire, state = _level(prev_state, cond)
        w, d = params["window"], params["direction"]
        return Evaluation(
            cond, f"Close {_num(close)} vs {w}-day average {_num(sma)} ({'above' if above else 'below'})", state, fire,
            f"{t} closed {d} its {w}-day average",
            f"{t} closed at {_num(close)}{f' on {as_of}' if as_of else ''}, {d} its {w}-day average of {_num(sma)}.",
            {"close": close, "sma": sma, "date": as_of},
        )

    if kind == "regime_change":
        regime = observed["regime"]
        prev = prev_state.get("regime")
        state = {"regime": regime}
        target = params.get("to", "any")
        fire = prev is not None and regime != prev and (target == "any" or regime == target)
        return Evaluation(
            regime == target if target != "any" else (prev is not None and regime != prev),
            f"Current regime {regime}" + (f" (was {prev})" if prev and prev != regime else ""),
            state, fire,
            f"{t} regime: {prev} → {regime}",
            f"The Markov regime model now classes {t} as {regime} (was {prev}).",
            {"from": prev, "to": regime},
        )

    if kind == "verdict_change":
        run_id, verdict = observed["run_id"], observed["verdict"]
        prev_run, prev_verdict = prev_state.get("run_id"), prev_state.get("verdict")
        state = {"run_id": run_id, "verdict": verdict}
        fire = prev_run is not None and run_id != prev_run and verdict != prev_verdict
        when = observed.get("analysis_date")
        return Evaluation(
            fire, f"Latest verdict {verdict.upper()}" + (f" ({when})" if when else ""), state, fire,
            f"{t} AI verdict: {str(prev_verdict).upper()} → {verdict.upper()}",
            f"A new analysis{f' for {when}' if when else ''} changed {t} from {str(prev_verdict).upper()} to {verdict.upper()}.",
            {"run_id": run_id, "from": prev_verdict, "to": verdict},
        )

    if kind == "portfolio_drawdown":
        dd = observed["drawdown"]  # negative fraction
        cond = -dd * 100 >= params["pct"]
        fire, state = _level(prev_state, cond)
        name = portfolio_name or "Your portfolio"
        peak = observed.get("peak_date")
        return Evaluation(
            cond, f"{-dd * 100:.1f}% below its peak (alert at {params['pct']:g}%)", state, fire,
            f"{name} is {-dd * 100:.1f}% below its peak",
            f"{name} is down {-dd * 100:.1f}% from its peak{f' on {peak}' if peak else ''} (alert at {params['pct']:g}%).",
            {"drawdown": dd, "peak_date": peak},
        )

    if kind == "position_weight":
        weights: dict[str, float] = observed["weights"]
        over = sorted(s for s, w in weights.items() if w * 100 > params["pct"])
        before = set(prev_state.get("over", []))
        new = [s for s in over if s not in before]
        name = portfolio_name or "your portfolio"
        top = max(weights.items(), key=lambda kv: kv[1]) if weights else None
        fire = bool(new)
        desc = ", ".join(f"{s} {weights[s] * 100:.0f}%" for s in new)
        return Evaluation(
            bool(over),
            f"Largest holding {top[0]} at {top[1] * 100:.1f}% (alert above {params['pct']:g}%)" if top else "No holdings",
            {"over": over}, fire,
            f"{', '.join(new)} now over {params['pct']:g}% of {name}" if new else "",
            f"{desc} of {name}, above your {params['pct']:g}% position limit." if new else "",
            {"over": over, "new": new},
        )

    raise RuleParamError(f"Unknown alert kind '{kind}'")
