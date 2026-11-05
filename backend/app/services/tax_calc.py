"""Tax helpers for the transaction ledger: realised gains by tax year, wash
sales, loss-harvest candidates and replacement ideas. Pure, no I/O.

Informational only, not tax advice. US rules, simplified:
- holding period: long term when held more than 365 days (ledger_calc);
- wash sale: a loss sale is (partly) disallowed when the same symbol is
  bought within 30 days before or after it, in any account or portfolio.
  Each replacement share absorbs one loss share, earliest buy first. The
  shares sold in that same sale are never their own replacement. The
  disallowed loss would move into the replacement shares' basis; this
  report states it but does not rewrite the lots;
- "substantially identical" is a legal judgement. Only the same symbol is
  matched, and replacement ideas skip funds tracking the same index.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from app.services.ledger_calc import LONG_TERM_DAYS, QTY_EPS, Lot, Realised

WASH_WINDOW_DAYS = 30
MIN_CORRELATION = 0.3  # below this a fund doesn't keep much of the exposure
MIN_OVERLAP_DAYS = 120

# Liquid ETFs offered as stand-ins that keep market exposure after a harvest.
REPLACEMENT_POOL: dict[str, str] = {
    "SPY": "S&P 500", "QQQ": "Nasdaq-100", "VTI": "US total market", "IWM": "Russell 2000",
    "XLK": "Technology sector", "XLF": "Financials sector", "XLV": "Health care sector", "XLE": "Energy sector",
    "XLI": "Industrials sector", "XLY": "Consumer discretionary sector", "XLP": "Consumer staples sector",
    "XLU": "Utilities sector", "XLB": "Materials sector", "XLRE": "Real estate sector", "XLC": "Communication services sector",
    "SMH": "Semiconductors", "VEA": "Developed markets ex-US", "VWO": "Emerging markets", "AGG": "US bonds", "GLD": "Gold",
}

# Funds tracking the same index are likely "substantially identical" to each other.
SAME_INDEX: tuple[frozenset[str], ...] = (
    frozenset({"SPY", "VOO", "IVV", "SPLG"}), frozenset({"QQQ", "QQQM"}), frozenset({"VTI", "ITOT", "SCHB"}),
    frozenset({"IWM", "VTWO"}), frozenset({"VEA", "IEFA"}), frozenset({"VWO", "IEMG"}), frozenset({"AGG", "BND"}),
    frozenset({"GLD", "IAU"}), frozenset({"XLK", "VGT"}), frozenset({"SMH", "SOXX"}),
)


@dataclass(frozen=True)
class BuyRef:
    """A BUY from any of the user's portfolios, for wash-sale matching."""
    tx_id: str
    date: date
    symbol: str
    quantity: float
    account: str
    portfolio: str


def wash_sales(realised: list[Realised], buys: list[BuyRef]) -> dict[int, dict]:
    """Index into `realised` → {"disallowed", "matched_quantity", "replacements"} for each loss
    row that a buy within ±30 days washes. Rows are matched in sale order."""
    remaining = {b.tx_id: b.quantity for b in buys}
    by_symbol: dict[str, list[BuyRef]] = defaultdict(list)
    for b in sorted(buys, key=lambda b: (b.date, b.tx_id)):
        by_symbol[b.symbol].append(b)
    # Shares of each buy sold in each sale: they can't replace themselves.
    sold_in: dict[tuple[str | None, str | None], float] = defaultdict(float)
    for r in realised:
        sold_in[(r.sell_tx_id, r.open_tx_id)] += r.quantity

    out: dict[int, dict] = {}
    for i, r in sorted(enumerate(realised), key=lambda ir: (ir[1].date, ir[0])):
        if r.gain >= -0.005:
            continue
        need, matched = r.quantity, []
        for b in by_symbol.get(r.symbol, []):
            if abs((b.date - r.date).days) > WASH_WINDOW_DAYS or b.tx_id == r.open_tx_id:
                continue
            available = remaining[b.tx_id] - sold_in.get((r.sell_tx_id, b.tx_id), 0.0)
            if available <= QTY_EPS:
                continue
            q = min(available, need)
            remaining[b.tx_id] -= q
            need -= q
            matched.append({"date": b.date.isoformat(), "account": b.account, "portfolio": b.portfolio,
                            "quantity": round(q, 10)})
            if need <= QTY_EPS:
                break
        if matched:
            share = (r.quantity - max(need, 0.0)) / r.quantity
            out[i] = {"disallowed": round(-r.gain * share, 2), "matched_quantity": round(r.quantity - max(need, 0.0), 10),
                      "replacements": matched}
    return out


def tax_year_report(realised: list[Realised], wash: dict[int, dict], year: int) -> dict:
    """Form 8949-style rows for sales in `year`, and totals per currency and term."""
    rows, totals = [], {}
    for i, r in enumerate(realised):
        if r.date.year != year:
            continue
        w = wash.get(i)
        disallowed = w["disallowed"] if w else 0.0
        rows.append({
            "date_sold": r.date.isoformat(), "date_acquired": r.open_date.isoformat(), "symbol": r.symbol,
            "account": r.account, "currency": r.currency, "quantity": round(r.quantity, 10),
            "proceeds": round(r.proceeds, 2), "cost": round(r.cost, 2), "gain": round(r.gain, 2),
            "term": r.term, "code": "W" if w else "", "adjustment": disallowed,
            "adjusted_gain": round(r.gain + disallowed, 2),
            "replacements": w["replacements"] if w else [],
        })
        t = totals.setdefault(r.currency, {"currency": r.currency, **{
            term: {"proceeds": 0.0, "cost": 0.0, "gain": 0.0, "adjustment": 0.0, "adjusted_gain": 0.0}
            for term in ("short", "long")}})[r.term]
        t["proceeds"] += r.proceeds
        t["cost"] += r.cost
        t["gain"] += r.gain
        t["adjustment"] += disallowed
        t["adjusted_gain"] += r.gain + disallowed
    for t in totals.values():
        for term in ("short", "long"):
            t[term] = {k: round(v, 2) for k, v in t[term].items()}
        t["net"] = round(t["short"]["adjusted_gain"] + t["long"]["adjusted_gain"], 2)
    rows.sort(key=lambda r: (r["date_sold"], r["symbol"], r["date_acquired"]))
    return {"year": year, "rows": rows, "totals": sorted(totals.values(), key=lambda t: t["currency"])}


def harvest_candidates(
    lots: dict[tuple[str, str], list[Lot]],
    prices: dict[str, float],
    fx: dict[str, float],
    buys: list[BuyRef],
    today: date,
    min_loss: float,
) -> list[dict]:
    """Open lots whose unrealised loss (in the display currency) is at least `min_loss`,
    largest first, with the wash-sale risk of selling them today."""
    out = []
    for (account, symbol), held in lots.items():
        price = prices.get(symbol)
        if price is None:
            continue
        f = fx.get(symbol, 1.0)
        for lot in held:
            loss_local = lot.quantity * (price - lot.cost_per_share)
            loss = loss_local * f
            if loss > -min_loss or lot.quantity <= QTY_EPS:
                continue
            held_days = (today - lot.open_date).days
            recent = [b for b in buys if b.symbol == symbol and 0 <= (today - b.date).days <= WASH_WINDOW_DAYS
                      and b.tx_id != lot.tx_id]
            out.append({
                "symbol": symbol, "account": account, "open_date": lot.open_date.isoformat(),
                "quantity": round(lot.quantity, 10), "cost_per_share": round(lot.cost_per_share, 6),
                "price": round(price, 6), "loss_local": round(loss_local, 2), "loss": round(loss, 2),
                "loss_pct": round(price / lot.cost_per_share - 1, 6) if lot.cost_per_share > 0 else None,
                "term": "long" if held_days > LONG_TERM_DAYS else "short",
                "days_to_long_term": max(0, LONG_TERM_DAYS + 1 - held_days) if held_days <= LONG_TERM_DAYS else 0,
                "recent_buys": [{"date": b.date.isoformat(), "account": b.account, "portfolio": b.portfolio,
                                 "quantity": round(b.quantity, 10)} for b in recent],
                "avoid_buying_until": (today + timedelta(days=WASH_WINDOW_DAYS + 1)).isoformat(),
            })
    out.sort(key=lambda c: c["loss"])
    return out


def _returns(closes: dict[date, float]) -> dict[date, float]:
    days = sorted(closes)
    return {d: closes[d] / closes[p] - 1 for p, d in zip(days, days[1:]) if closes[p] > 0}


def _corr(a: list[float], b: list[float]) -> float | None:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    return cov / math.sqrt(va * vb) if va > 0 and vb > 0 else None


def replacement_ideas(symbol: str, closes: dict[str, dict[date, float]], limit: int = 5) -> list[dict]:
    """Pool ETFs ranked by daily-return correlation with `symbol`, skipping the symbol itself
    and funds that track the same index as it."""
    symbol = symbol.upper()
    target = _returns(closes.get(symbol, {}))
    if len(target) < MIN_OVERLAP_DAYS:
        return []
    twins = set().union(*(g for g in SAME_INDEX if symbol in g)) | {symbol}
    ideas = []
    for cand, label in REPLACEMENT_POOL.items():
        if cand in twins:
            continue
        other = _returns(closes.get(cand, {}))
        common = sorted(set(target) & set(other))
        if len(common) < MIN_OVERLAP_DAYS:
            continue
        c = _corr([target[d] for d in common], [other[d] for d in common])
        if c is not None and c >= MIN_CORRELATION:
            strength = "close" if c >= 0.8 else "moderate" if c >= 0.6 else "loose"
            ideas.append({"symbol": cand, "name": label, "correlation": round(c, 3), "strength": strength,
                          "days": len(common)})
    ideas.sort(key=lambda x: -x["correlation"])
    return ideas[:limit]
