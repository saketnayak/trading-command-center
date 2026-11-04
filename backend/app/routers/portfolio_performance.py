"""GET /portfolio/{id}/performance: time-weighted return against a benchmark.

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

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.ticker_metadata import TickerMetadata
from app.models.user import User
from app.services import fx_service
from app.services.performance_calc import HoldingsPeriod, compute_performance
from app.services.price_history_service import get_closes
from app.utils.quote_currency import quote_currency_from_ticker

router = APIRouter()

RangeKey = Literal["1m", "3m", "6m", "ytd", "1y", "3y", "5y"]
_RANGE_DAYS = {"1m": 31, "3m": 92, "6m": 183, "1y": 366, "3y": 365 * 3 + 1, "5y": 365 * 5 + 1}
MIN_ACTUAL_HISTORY_DAYS = 30
_BENCHMARK_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-^=]{0,15}$")
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


def _aggregate(holdings) -> dict[str, float]:
    shares: dict[str, float] = {}
    for h in holdings:
        sym = h.ticker.strip().upper()
        shares[sym] = shares.get(sym, 0.0) + float(h.shares or 0.0)
    return {s: q for s, q in shares.items() if q > 0}


async def _fx_factors(db: AsyncSession, symbols: list[str], display_currency: str) -> tuple[dict[str, float], dict[str, str]]:
    """symbol → factor into the display currency, plus each symbol's listing currency."""
    meta = {
        row.ticker.upper(): (row.currency or "").upper()
        for row in (await db.execute(select(TickerMetadata).where(TickerMetadata.ticker.in_(symbols)))).scalars()
    }
    target = await fx_service.get_rate(display_currency)
    factors: dict[str, float] = {}
    currencies: dict[str, str] = {}
    for sym in symbols:
        ccy = quote_currency_from_ticker(sym) or meta.get(sym) or "USD"
        currencies[sym] = ccy
        local = await fx_service.get_rate(ccy) if ccy in fx_service.SUPPORTED_CURRENCIES else 1.0
        factors[sym] = target / local if local else 1.0
    return factors, currencies


@router.get("/portfolio/{portfolio_id}/performance")
async def portfolio_performance(
    portfolio_id: UUID,
    mode: Literal["auto", "actual", "current"] = Query("auto"),
    range_key: RangeKey = Query("1y", alias="range"),
    benchmark: str = Query("SPY", min_length=1, max_length=16),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    benchmark = benchmark.strip().upper()
    if not _BENCHMARK_RE.match(benchmark):
        raise HTTPException(status_code=422, detail=f"'{benchmark}' is not a valid benchmark ticker")

    portfolio = (
        await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    ).scalar_one_or_none()
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    snapshots = (
        await db.execute(
            select(PortfolioSnapshot)
            .where(PortfolioSnapshot.portfolio_id == portfolio_id)
            .options(selectinload(PortfolioSnapshot.holdings))
            .order_by(PortfolioSnapshot.uploaded_at)
        )
    ).scalars().all()

    today = datetime.now(timezone.utc).date()
    display_currency = (user.preferred_currency or "USD").upper()
    base = {
        "portfolio_id": str(portfolio_id),
        "benchmark": benchmark,
        "range": range_key,
        "display_currency": display_currency,
        "methodology": METHODOLOGY,
    }

    # One period per upload day; a later upload on the same day replaces an earlier one.
    by_day: dict[date, dict[str, float]] = {}
    for snap in snapshots:
        by_day[snap.uploaded_at.astimezone(timezone.utc).date()] = _aggregate(snap.holdings)
    history_start = min(by_day) if by_day else None
    history_days = (today - history_start).days if history_start else 0
    latest = by_day[max(by_day)] if by_day else {}

    if not latest:
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
                f"Upload history starts on {history_start.isoformat()}, so the chart starts there."
            )
    else:
        periods = [HoldingsPeriod(start=date.min, shares=latest)]
        warnings.append("What-if view: today's holdings held unchanged over the whole range, not your actual trades.")

    symbols = sorted({s for p in periods for s in p.shares})
    closes, failed = await get_closes(db, [*symbols, benchmark], start - _PRICE_LOOKBACK, today)
    bench_closes = closes.pop(benchmark, {}) if benchmark not in symbols else dict(closes.get(benchmark, {}))
    fx, currencies = await _fx_factors(db, symbols, display_currency)

    result = compute_performance(
        periods=periods,
        closes={s: closes.get(s, {}) for s in symbols},
        fx=fx,
        benchmark=bench_closes or None,
        start=start,
        end=today,
    )

    unpriced = sorted(set(result.pop("unpriced")) | (failed & set(symbols)))
    if unpriced:
        warnings.append(
            "No price history for " + ", ".join(unpriced) + "; those holdings are left out of the return."
        )
    if not bench_closes:
        warnings.append(f"No price history for benchmark {benchmark}.")
    if len({currencies[s] for s in symbols}) > 1:
        warnings.append("Holdings trade in more than one currency; returns exclude FX moves.")

    return {**base, "mode": mode, "history_days": history_days, "warnings": warnings, **result}
