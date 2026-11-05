"""Dividend income maths: per-symbol payment patterns, forward income,
calendar and a reinvestment projection. Pure, no I/O.

Estimates, all from the symbol's own payment history:
- frequency: the median gap between recent payments (monthly, quarterly,
  semi-annual, annual), from the last 8 payments;
- forward dividend per share: the median of the most recent year's worth of
  payments × payments per year, so a single special dividend can't inflate it;
- next ex-dates: the last ex-date stepped forward by that median gap;
- 5-year dividend growth: the last year's worth of payments vs the same number
  of payments ending about five years earlier, annualised.
A symbol whose last payment is older than 1.5 payment gaps (and over 400
days) is treated as suspended: no forward income.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date, timedelta

FREQUENCIES = ((45, "monthly", 12), (100, "quarterly", 4), (200, "semi-annual", 2), (10_000, "annual", 1))
MAX_GROWTH = 0.15
MIN_GROWTH = -0.10


@dataclass(frozen=True)
class SymbolIncome:
    frequency: str | None  # monthly / quarterly / semi-annual / annual; None = no regular payments
    payments_per_year: int
    last_ex_date: date | None
    last_amount: float | None
    ttm_per_share: float
    forward_per_share: float
    next_ex_dates: tuple[date, ...]
    growth_5y: float | None  # annualised dividend growth over five years
    suspended: bool


def _months_ago(d: date, months: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 - months, 12)
    return date(y, m + 1, min(d.day, 28))


def analyse(divs: list[tuple[date, float]], today: date) -> SymbolIncome:
    divs = sorted((d, a) for d, a in divs if d <= today and a > 0)
    ttm = sum(a for d, a in divs if d > today - timedelta(days=365))
    if not divs:
        return SymbolIncome(None, 0, None, None, 0.0, 0.0, (), None, False)

    recent = divs[-9:]
    gaps = [(b[0] - a[0]).days for a, b in zip(recent, recent[1:])]
    median_gap = statistics.median(gaps) if gaps else 365
    freq, per_year = next((name, n) for limit, name, n in FREQUENCIES if median_gap <= limit)
    last_date, last_amount = divs[-1]
    suspended = (today - last_date).days > max(400, 1.5 * median_gap)

    last_year = [a for _, a in divs[-per_year:]]
    forward = 0.0 if suspended else statistics.median(last_year) * per_year

    step = timedelta(days=round(median_gap)) if gaps else timedelta(days=365)
    next_dates: list[date] = []
    if not suspended:
        d = last_date + step
        while d <= today + timedelta(days=365):
            if d > today:
                next_dates.append(d)
            d += step

    # Growth compares a year's worth of payments (by count, not by calendar
    # window, so payment timing can't put 3 payments in one year and 5 in
    # the other) ending at the last payment with the year ending ~5 years earlier.
    growth = None
    anchor = _months_ago(last_date, 60) + timedelta(days=round(median_gap / 2))
    old_end = max((i for i, (d, _) in enumerate(divs) if d <= anchor), default=None)
    if not suspended and old_end is not None and old_end + 1 >= per_year:
        then_sum = sum(a for _, a in divs[old_end - per_year + 1:old_end + 1])
        now_sum = sum(last_year)
        years = (last_date - divs[old_end][0]).days / 365.25
        if then_sum > 0 and years >= 4:
            growth = (now_sum / then_sum) ** (1 / years) - 1

    return SymbolIncome(freq, per_year, last_date, last_amount, round(ttm, 6), round(forward, 6),
                        tuple(next_dates), round(growth, 6) if growth is not None else None, suspended)


def calendar(entries: list[tuple[str, SymbolIncome, float]], today: date) -> list[dict]:
    """Expected income by month over the next 12 months, from projected ex-dates.
    entries: (ticker, analysis, income per payment in the display currency)."""
    months = []
    for i in range(12):
        y, m = divmod(today.year * 12 + today.month - 1 + i, 12)
        months.append(f"{y:04d}-{m + 1:02d}")
    buckets: dict[str, dict] = {k: {"month": k, "amount": 0.0, "payments": []} for k in months}
    for ticker, info, per_payment in entries:
        for d in info.next_ex_dates:
            key = f"{d.year:04d}-{d.month:02d}"
            if key in buckets and per_payment > 0:
                buckets[key]["amount"] += per_payment
                buckets[key]["payments"].append({"ticker": ticker, "ex_date": d.isoformat(), "amount": round(per_payment, 2)})
    return [{**b, "amount": round(b["amount"], 2)} for b in buckets.values()]


def projection(annual_income: float, portfolio_value: float, growth: float | None, years: int = 10) -> dict:
    """Income each year with and without reinvesting dividends.

    Assumes the dividend grows at `growth` a year and prices grow at the same
    rate, so the yield stays constant; reinvesting then adds `yield` more shares
    each year. Transparent rather than predictive.
    """
    g = max(MIN_GROWTH, min(MAX_GROWTH, growth if growth is not None else 0.0))
    y = annual_income / portfolio_value if portfolio_value > 0 else 0.0
    rows = []
    for t in range(years + 1):
        base = annual_income * (1 + g) ** t
        rows.append({"year": t, "without_drip": round(base, 2), "with_drip": round(base * (1 + y) ** t, 2)})
    return {"growth": round(g, 4), "yield": round(y, 4), "years": rows}
