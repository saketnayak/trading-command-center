"""Service behind GET /portfolio/{id}/performance: time-weighted return against a benchmark.

Two modes:
  actual   follows the snapshot timeline (each upload's holdings apply from
           its upload date until the next upload).
  current  holds today's holdings across the whole range. Useful when there
           is little upload history; it is a what-if, and the response says so.
  auto     (default) picks actual when there are at least
           MIN_ACTUAL_HISTORY_DAYS of snapshot history, otherwise current.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.services.performance_calc import HoldingsPeriod, compute_performance, xirr
from app.services import ledger_service
from app.services.ledger_calc import holdings_timeline
from app.services.portfolio_pricing import aggregate_shares, fx_factors
from app.services.price_history_service import get_closes

RangeKey = Literal["1m", "3m", "6m", "ytd", "1y", "3y", "5y"]
_RANGE_DAYS = {"1m": 31, "3m": 92, "6m": 183, "1y": 366, "3y": 365 * 3 + 1, "5y": 365 * 5 + 1}
MIN_ACTUAL_HISTORY_DAYS = 30
BENCHMARK_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-^=]{0,15}$")
_PRICE_LOOKBACK = timedelta(days=10)  # a few days before the window, for the first day's close

METHODOLOGY = (
    "Time-weighted return on the holdings held at each previous close; a change of holdings "
    "is a cash flow, not a gain or loss. Prices are adjusted closes (dividends reinvested). "
    "Values use today's FX rates, so these are local-currency returns without FX moves. "
    "Cash is not tracked."
)


def _range_start(range_key: str, today: date) -> date:
    if range_key == "ytd":
        return date(today.year - 1, 12, 31)
    return today - timedelta(days=_RANGE_DAYS[range_key])


async def build_performance_report(
    db: AsyncSession,
    portfolio_id: UUID,
    *,
    display_currency: str,
    mode: str = "auto",
    range_key: str = "1y",
    benchmark: str = "SPY",
) -> dict:
    """Performance report for a portfolio (ownership already checked by the caller)."""
    snapshots = (
        await db.execute(
            select(PortfolioSnapshot)
            .where(PortfolioSnapshot.portfolio_id == portfolio_id)
            .options(selectinload(PortfolioSnapshot.holdings))
            .order_by(PortfolioSnapshot.uploaded_at)
        )
    ).scalars().all()

    today = datetime.now(timezone.utc).date()
    base = {
        "portfolio_id": str(portfolio_id),
        "benchmark": benchmark,
        "range": range_key,
        "display_currency": display_currency,
        "methodology": METHODOLOGY,
    }

    source = (await db.execute(select(Portfolio.holdings_source).where(Portfolio.id == portfolio_id))).scalar_one_or_none()
    txs = await ledger_service.load_txs(db, portfolio_id) if source == "ledger" else []
    base["holdings_source"] = "ledger" if txs else "snapshot"

    by_day: dict[date, dict[str, float]] = {}
    if txs:
        # Ledger-backed: holdings change on the real trade dates.
        by_day = dict(holdings_timeline(txs))
    else:
        # One period per upload day; a later upload on the same day replaces an earlier one.
        for snap in snapshots:
            by_day[snap.uploaded_at.astimezone(timezone.utc).date()] = aggregate_shares(snap.holdings)
    history_start = min(by_day) if by_day else None
    history_days = (today - history_start).days if history_start else 0
    latest = by_day[max(by_day)] if by_day else {}

    if not latest and not (txs and mode != "current"):
        return {**base, "mode": mode if mode != "auto" else "current", "history_days": history_days,
                "warnings": [], "series": [], "stats": None, "benchmark_stats": None, "period_returns": None,
                "benchmark_period_returns": None, "holdings": [], "start": None, "end": None,
                "message": "This portfolio has no holdings yet. Upload a CSV or add a holding first."}

    if mode == "auto":
        mode = "actual" if history_days >= MIN_ACTUAL_HISTORY_DAYS else "current"

    start = _range_start(range_key, today)
    warnings: list[str] = []
    if mode == "actual":
        periods = [HoldingsPeriod(start=d, shares=s) for d, s in sorted(by_day.items())]
        if history_start > start:
            start = history_start
            warnings.append(
                f"{'Transactions start' if txs else 'Upload history starts'} on {history_start.isoformat()}, "
                "so the chart starts there."
            )
    else:
        periods = [HoldingsPeriod(start=date.min, shares=latest)]
        warnings.append("What-if view: today's holdings held unchanged over the whole range, not your actual trades.")

    symbols = sorted({s for p in periods for s in p.shares})
    closes, failed = await get_closes(db, [*symbols, benchmark], start - _PRICE_LOOKBACK, today)
    bench_closes = closes.pop(benchmark, {}) if benchmark not in symbols else dict(closes.get(benchmark, {}))
    fx, currencies = await fx_factors(db, symbols, display_currency)

    result = compute_performance(
        periods=periods,
        closes={s: closes.get(s, {}) for s in symbols},
        fx=fx,
        benchmark=bench_closes or None,
        start=start,
        end=today,
    )

    # The calc decides what had no usable price. A failed refresh with older
    # stored rows still prices the holding; it is only out of date.
    unpriced = sorted(result.pop("unpriced"))
    if unpriced:
        warnings.append(
            "No price history for " + ", ".join(unpriced) + "; those holdings are left out of the return."
        )
    stale = sorted(s for s in failed & set(symbols) if s not in unpriced and closes.get(s))
    if stale:
        warnings.append(
            "Could not refresh prices for " + ", ".join(stale) + "; showing the last stored prices "
            f"(up to {max(max(closes[s]) for s in stale).isoformat()})."
        )
    if not bench_closes:
        warnings.append(f"No price history for benchmark {benchmark}.")
    if len({currencies[s] for s in symbols}) > 1:
        warnings.append("Holdings trade in more than one currency; returns exclude FX moves.")

    if txs and mode == "actual" and result.get("series"):
        result["stats"].update(_money_weighted(txs, result["series"], fx))
        base["methodology"] = METHODOLOGY + " " + MWR_NOTE

    return {**base, "mode": mode, "history_days": history_days, "warnings": warnings, **result}


MWR_NOTE = (
    "Money-weighted return (IRR) uses the ledger's trades as cash flows at their trade prices and fees; "
    "dividends are already in the adjusted prices, so they are not counted again as flows."
)


def _money_weighted(txs, series: list[dict], fx: dict[str, float]) -> dict:
    """IRR over the charted window: the opening value goes in, each later buy goes in and
    each sale comes out (trade price ± fees, converted like the holdings), and the
    ending value comes out."""
    d0 = date.fromisoformat(series[0]["date"])
    d1 = date.fromisoformat(series[-1]["date"])
    flows: list[tuple[date, float]] = [(d0, -series[0]["value"])]
    for t in txs:
        if not (d0 < t.date <= d1) or t.type not in ("BUY", "SELL"):
            continue
        f = fx.get(t.symbol, 1.0)
        if t.type == "BUY":
            flows.append((t.date, -(t.quantity * t.price + t.fees) * f))
        else:
            flows.append((t.date, (t.quantity * t.price - t.fees) * f))
    flows.append((d1, series[-1]["value"]))
    annual = xirr(flows)
    span = (d1 - d0).days
    if annual is None or span <= 0:
        return {"mwr_annualised": None, "mwr_period": None}
    return {
        "mwr_annualised": round(annual, 6) if span >= 365 else None,
        "mwr_period": round((1 + annual) ** (span / 365.25) - 1, 6),
    }
