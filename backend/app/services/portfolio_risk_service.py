"""Service behind GET /portfolio/{id}/risk: how risky today's holdings are.

Current value weights applied to each holding's daily returns over the
lookback window (from the price_bars store), plus stress replays and a
bootstrap Monte Carlo. See services/risk_calc.py for the maths.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

import numpy as np
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.portfolio import PortfolioSnapshot
from app.services.performance_calc import PriceLookup, build_calendar
from app.services.portfolio_pricing import aggregate_shares, fx_factors
from app.services.price_history_service import get_closes, history_start
from app.services.risk_calc import STRESS_SCENARIOS, compute_risk, stress_test

LookbackKey = Literal["6m", "1y", "3y"]
_LOOKBACK_DAYS = {"6m": 183, "1y": 366, "3y": 365 * 3 + 1}
MIN_OBSERVATIONS = 20  # fewer daily returns than this and a holding is left out of the statistics
STRESS_MARKET = "SPY"

METHODOLOGY = (
    "Today's holdings and value weights applied to each holding's daily returns over the lookback "
    "(adjusted closes). VaR/CVaR are 1-day historical figures at 95%. Risk share is each holding's "
    "share of portfolio variance. Stress tests replay real prices where the store covers the window "
    "and otherwise use beta × the S&P 500's move. The Monte Carlo resamples 5-day blocks of the "
    "portfolio's own history: a range of plausible outcomes, not a forecast. Cash is not tracked."
)


def _window_return(lookup: PriceLookup | None, start: date, end: date) -> float | None:
    if lookup is None or not lookup.dates or lookup.dates[0] > start + timedelta(days=7):
        return None  # no price at (or within a week after) the window start: the holding did not trade yet
    p0 = lookup.at(start) or _first_on_or_after(lookup, start)
    p1 = lookup.at(end)
    return p1 / p0 - 1 if p0 and p1 else None


def _first_on_or_after(lookup: PriceLookup, d: date) -> float | None:
    for day in lookup.dates:
        if day >= d:
            return lookup.closes[day] if (day - d).days <= 7 else None
    return None


def _beta(r: np.ndarray, b: np.ndarray) -> float | None:
    if r.size < MIN_OBSERVATIONS or b.size != r.size or float(np.var(b, ddof=1)) <= 0:
        return None
    return float(np.cov(r, b, ddof=1)[0, 1] / np.var(b, ddof=1))


async def build_risk_report(
    db: AsyncSession,
    portfolio_id: UUID,
    *,
    display_currency: str,
    lookback: str = "1y",
    benchmark: str = "SPY",
) -> dict:
    """Risk report for a portfolio (ownership already checked by the caller)."""
    snapshot = (
        await db.execute(
            select(PortfolioSnapshot)
            .where(PortfolioSnapshot.portfolio_id == portfolio_id)
            .options(selectinload(PortfolioSnapshot.holdings))
            .order_by(desc(PortfolioSnapshot.uploaded_at))
            .limit(1)
        )
    ).scalar_one_or_none()

    base = {
        "portfolio_id": str(portfolio_id),
        "lookback": lookback,
        "benchmark": benchmark,
        "display_currency": display_currency,
        "methodology": METHODOLOGY,
    }
    shares = aggregate_shares(snapshot.holdings) if snapshot else {}
    if not shares:
        return {**base, "warnings": [], "message": "This portfolio has no holdings yet.", "risk": None, "stress": []}

    today = datetime.now(timezone.utc).date()
    symbols = sorted(shares)
    closes, failed = await get_closes(db, [*symbols, benchmark, STRESS_MARKET], history_start(today), today)
    lookups = {s: PriceLookup(c) for s, c in closes.items() if c}
    fx, currencies = await fx_factors(db, symbols, display_currency)

    warnings: list[str] = []
    values: dict[str, float] = {}
    for s in symbols:
        px = lookups[s].at(today) if s in lookups else None
        if px is not None:
            values[s] = shares[s] * px * fx.get(s, 1.0)
    no_price = [s for s in symbols if s not in values]

    # Daily returns on the benchmark's calendar over the lookback.
    start = today - timedelta(days=_LOOKBACK_DAYS[lookback])
    window = {s: {d: c for d, c in closes.get(s, {}).items() if start <= d <= today} for s in values}
    calendar = build_calendar(
        {d: c for d, c in closes.get(benchmark, {}).items() if start <= d <= today} or None, window, start, today
    )

    def daily_returns(sym: str) -> tuple[np.ndarray, int]:
        lookup = lookups.get(sym)
        out = np.zeros(max(len(calendar) - 1, 0))
        real = 0
        for i, (prev, cur) in enumerate(zip(calendar, calendar[1:])):
            p0 = lookup.at(prev) if lookup else None
            p1 = lookup.at(cur) if lookup else None
            if p0 and p1:
                out[i] = p1 / p0 - 1
                real += 1
        return out, real

    columns: dict[str, np.ndarray] = {}
    short_history: list[str] = []
    for s in values:
        r, real = daily_returns(s)
        if real < MIN_OBSERVATIONS:
            short_history.append(s)
        else:
            columns[s] = r
    included = sorted(columns)
    if not included:
        return {**base, "warnings": [f"Not enough price history for {', '.join(symbols)}."], "risk": None,
                "stress": [], "message": "Not enough price history to measure risk yet."}

    total_value = sum(values.values())
    included_value = sum(values[s] for s in included)
    weights = {s: values[s] / included_value for s in included}
    matrix = np.column_stack([columns[s] for s in included])
    bench_r, bench_real = daily_returns(benchmark)
    risk = compute_risk(
        symbols=included,
        returns=matrix,
        weights=weights,
        benchmark_returns=bench_r if bench_real >= MIN_OBSERVATIONS else None,
        portfolio_value=included_value,
    )
    risk.pop("_portfolio_returns", None)

    # Stress: real window moves where stored prices cover them, else beta vs SPY × the S&P 500 move.
    spy_r, spy_real = daily_returns(STRESS_MARKET)
    betas = {s: (_beta(columns[s], spy_r) if spy_real >= MIN_OBSERVATIONS else None) for s in included}
    window_returns = {sc.id: {s: _window_return(lookups.get(s), sc.start, sc.end) for s in included}
                      for sc in STRESS_SCENARIOS}
    spy_windows = {sc.id: _window_return(lookups.get(STRESS_MARKET), sc.start, sc.end) for sc in STRESS_SCENARIOS}
    stress = stress_test(weights=weights, window_returns=window_returns, sp500_window_returns=spy_windows,
                         betas_vs_sp500=betas, portfolio_value=included_value)

    if no_price:
        warnings.append("No price for " + ", ".join(no_price) + "; left out of the risk figures.")
    if short_history:
        warnings.append(
            "Less than a month of price history for " + ", ".join(sorted(short_history))
            + "; left out of the risk figures."
        )
    if included_value < total_value - 1e-9:
        warnings.append(f"Risk figures cover {included_value / total_value:.0%} of the portfolio's value.")
    if bench_real < MIN_OBSERVATIONS:
        warnings.append(f"No usable price history for benchmark {benchmark}; beta is unavailable.")
    if risk["observations"] < 120:
        warnings.append("Short lookback: fewer than 120 trading days, so these estimates are noisy.")
    if len({currencies[s] for s in included}) > 1:
        warnings.append("Holdings trade in more than one currency; returns exclude FX moves.")
    stale = sorted(s for s in failed & set(symbols) if s in values)
    if stale:
        warnings.append("Could not refresh prices for " + ", ".join(stale) + "; using the last stored prices.")

    return {
        **base,
        "as_of": calendar[-1].isoformat() if calendar else None,
        "warnings": warnings,
        "message": None,
        "risk": risk,
        "stress": stress,
    }
