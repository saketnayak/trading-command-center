"""Portfolio performance maths: pure functions, no I/O.

Holdings-based time-weighted return. Each day's return is measured on the
holdings held at the previous close:

    r_t = Σ shares_i(t-1) · P_i(t) / Σ shares_i(t-1) · P_i(t-1) − 1

so a change of holdings (a new snapshot) is a cash flow and never counts as
gain or loss. Returns chain into an index (100 at the start). Prices are
adjusted closes, so dividends are treated as reinvested.

Every value is converted with one constant FX factor per symbol (today's
rate), so the figures are local-currency returns; FX moves are not
included. AgentFloor has no historical FX series yet.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from dataclasses import dataclass
import calendar as _cal
from datetime import date, timedelta

TRADING_DAYS = 252
MAX_FORWARD_FILL = timedelta(days=7)  # an older last price counts as missing
MIN_ANNUALISE_DAYS = 365


@dataclass(frozen=True)
class HoldingsPeriod:
    """Shares held from `start` (inclusive) until the next period starts."""

    start: date
    shares: dict[str, float]


class _Prices:
    """Close lookup with a bounded forward fill (weekends, holidays, exchanges
    that are shut on days the benchmark trades)."""

    def __init__(self, closes: dict[date, float]):
        self.dates = sorted(closes)
        self.closes = closes

    def at(self, d: date) -> float | None:
        i = bisect_right(self.dates, d) - 1
        if i < 0:
            return None
        found = self.dates[i]
        if d - found > MAX_FORWARD_FILL:
            return None
        return self.closes[found]


def _shares_on(periods: list[HoldingsPeriod], d: date) -> dict[str, float]:
    current: dict[str, float] = {}
    for p in periods:
        if p.start <= d:
            current = p.shares
        else:
            break
    return current


def build_calendar(benchmark: dict[date, float] | None, closes: dict[str, dict[date, float]],
                   start: date, end: date) -> list[date]:
    """Trading days in [start, end]. The benchmark's calendar is used when it
    has data, so crypto weekend moves fold into Monday instead of adding
    days on which the benchmark cannot move."""
    if benchmark:
        days = sorted(d for d in benchmark if start <= d <= end)
        if len(days) >= 2:
            return days
    union = {d for series in closes.values() for d in series if start <= d <= end}
    return sorted(union)


def _minus_months(d: date, months: int) -> date:
    """`d` moved back by whole months, clamped to the month's last day (Mar 31 → Feb 28)."""
    y, m = divmod(d.year * 12 + d.month - 1 - months, 12)
    m += 1
    return date(y, m, min(d.day, _cal.monthrange(y, m)[1]))


def _stdev(xs: list[float]) -> float | None:
    if len(xs) < 2:
        return None
    mean = sum(xs) / len(xs)
    return math.sqrt(sum((x - mean) ** 2 for x in xs) / (len(xs) - 1))


def _round(x: float | None, places: int = 6) -> float | None:
    return None if x is None or not math.isfinite(x) else round(x, places)


def _max_drawdown(dates: list[date], index: list[float]) -> tuple[float, date | None, date | None]:
    peak, peak_date = -math.inf, None
    worst, worst_peak, worst_trough = 0.0, None, None
    for d, v in zip(dates, index):
        if v > peak:
            peak, peak_date = v, d
        dd = v / peak - 1 if peak > 0 else 0.0
        if dd < worst:
            worst, worst_peak, worst_trough = dd, peak_date, d
    return worst, worst_peak, worst_trough


def series_stats(dates: list[date], index: list[float], returns: list[float],
                 risk_free_rate: float = 0.0) -> dict:
    """Return, risk and drawdown figures for one index series."""
    if len(index) < 2:
        return {"total_return": None, "annualised_return": None, "volatility": None, "sharpe": None,
                "max_drawdown": None, "max_drawdown_peak": None, "max_drawdown_trough": None,
                "best_day": None, "worst_day": None}
    total = index[-1] / index[0] - 1
    span_days = (dates[-1] - dates[0]).days
    annualised = (1 + total) ** (365.25 / span_days) - 1 if span_days >= MIN_ANNUALISE_DAYS and total > -1 else None
    sd = _stdev(returns)
    vol = sd * math.sqrt(TRADING_DAYS) if sd is not None else None
    mean_annual = sum(returns) / len(returns) * TRADING_DAYS if returns else None
    sharpe = (mean_annual - risk_free_rate) / vol if vol and mean_annual is not None else None
    mdd, peak_d, trough_d = _max_drawdown(dates, index)
    best = max(range(len(returns)), key=lambda i: returns[i]) if returns else None
    worst = min(range(len(returns)), key=lambda i: returns[i]) if returns else None
    return {
        "total_return": _round(total),
        "annualised_return": _round(annualised),
        "volatility": _round(vol),
        "sharpe": _round(sharpe, 3),
        "max_drawdown": _round(mdd),
        "max_drawdown_peak": peak_d.isoformat() if peak_d else None,
        "max_drawdown_trough": trough_d.isoformat() if trough_d else None,
        # returns[i] is the move from dates[i] to dates[i + 1]
        "best_day": {"date": dates[best + 1].isoformat(), "return": _round(returns[best])} if best is not None else None,
        "worst_day": {"date": dates[worst + 1].isoformat(), "return": _round(returns[worst])} if worst is not None else None,
    }


def period_returns(dates: list[date], index: list[float]) -> dict[str, float | None]:
    """Trailing returns ending on the last date. A window that starts before
    the series does is None rather than silently shortened."""
    if len(index) < 2:
        return {k: None for k in ("1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y")}
    end = dates[-1]
    anchors = {
        "1W": end - timedelta(days=7),
        "1M": _minus_months(end, 1),
        "3M": _minus_months(end, 3),
        "6M": _minus_months(end, 6),
        "YTD": date(end.year - 1, 12, 31),
        "1Y": _minus_months(end, 12),
        "3Y": _minus_months(end, 36),
        "5Y": _minus_months(end, 60),
    }
    out: dict[str, float | None] = {}
    for key, anchor in anchors.items():
        if anchor < dates[0]:
            out[key] = None
            continue
        i = bisect_right(dates, anchor) - 1
        out[key] = _round(index[-1] / index[i] - 1)
    return out


def _beta_corr(r: list[float], b: list[float]) -> tuple[float | None, float | None]:
    if len(r) < 3 or len(r) != len(b):
        return None, None
    mr, mb = sum(r) / len(r), sum(b) / len(b)
    cov = sum((x - mr) * (y - mb) for x, y in zip(r, b)) / (len(r) - 1)
    var_b = sum((y - mb) ** 2 for y in b) / (len(b) - 1)
    var_r = sum((x - mr) ** 2 for x in r) / (len(r) - 1)
    beta = cov / var_b if var_b > 0 else None
    corr = cov / math.sqrt(var_r * var_b) if var_r > 0 and var_b > 0 else None
    return _round(beta, 4), _round(corr, 4)


def compute_performance(
    *,
    periods: list[HoldingsPeriod],
    closes: dict[str, dict[date, float]],
    fx: dict[str, float],
    benchmark: dict[date, float] | None,
    start: date,
    end: date,
    risk_free_rate: float = 0.0,
) -> dict:
    """Value, index and drawdown series plus summary stats for a holdings
    timeline. `fx` maps symbol → factor into the display currency."""
    periods = sorted(periods, key=lambda p: p.start)
    prices = {sym: _Prices(c) for sym, c in closes.items()}
    bench = _Prices(benchmark) if benchmark else None
    calendar = build_calendar(benchmark, closes, start, end)

    def value_of(shares: dict[str, float], d: date) -> tuple[float, set[str]]:
        total, missing = 0.0, set()
        for sym, qty in shares.items():
            px = prices[sym].at(d) if sym in prices else None
            if px is None:
                missing.add(sym)
                continue
            total += qty * px * fx.get(sym, 1.0)
        return total, missing

    # Start on the first calendar day the portfolio actually holds something priced.
    first = next((i for i, d in enumerate(calendar) if value_of(_shares_on(periods, d), d)[0] > 0), None)
    if first is None:
        return _empty("No priced holdings in this window.")
    calendar = calendar[first:]

    dates = [calendar[0]]
    index = [100.0]
    bench_index = [100.0] if bench and bench.at(calendar[0]) else None
    values = [value_of(_shares_on(periods, calendar[0]), calendar[0])[0]]
    returns: list[float] = []
    bench_returns: list[float] = []
    paired_r: list[float] = []
    paired_b: list[float] = []
    contrib: dict[str, float] = {}
    unpriced: set[str] = set()

    for prev, cur in zip(calendar, calendar[1:]):
        held = _shares_on(periods, prev)
        num = den = 0.0
        legs: list[tuple[str, float, float]] = []  # (symbol, start value, symbol return)
        for sym, qty in held.items():
            p0 = prices[sym].at(prev) if sym in prices else None
            p1 = prices[sym].at(cur) if sym in prices else None
            if p0 is None or p1 is None:
                unpriced.add(sym)
                continue
            f = fx.get(sym, 1.0)
            num += qty * p1 * f
            den += qty * p0 * f
            legs.append((sym, qty * p0 * f, p1 / p0 - 1))
        r = num / den - 1 if den > 0 else 0.0
        for sym, v0, sr in legs:
            contrib[sym] = contrib.get(sym, 0.0) + (v0 / den) * sr
        returns.append(r)
        dates.append(cur)
        index.append(index[-1] * (1 + r))
        value, missing = value_of(_shares_on(periods, cur), cur)
        unpriced |= missing
        values.append(value)

        if bench_index is not None:
            b0, b1 = bench.at(prev), bench.at(cur)
            br = b1 / b0 - 1 if b0 and b1 else 0.0
            bench_returns.append(br)
            bench_index.append(bench_index[-1] * (1 + br))
            if b0 and b1:
                paired_r.append(r)
                paired_b.append(br)

    peak = -math.inf
    series = []
    for i, d in enumerate(dates):
        peak = max(peak, index[i])
        series.append({
            "date": d.isoformat(),
            "value": round(values[i], 2),
            "index": round(index[i], 4),
            "benchmark_index": round(bench_index[i], 4) if bench_index is not None else None,
            "drawdown": round(index[i] / peak - 1, 6),
        })

    stats = series_stats(dates, index, returns, risk_free_rate)
    bench_stats = series_stats(dates, bench_index, bench_returns, risk_free_rate) if bench_index else None
    beta, corr = _beta_corr(paired_r, paired_b)
    excess = (
        _round(stats["total_return"] - bench_stats["total_return"])
        if bench_stats and stats["total_return"] is not None and bench_stats["total_return"] is not None
        else None
    )

    end_shares = _shares_on(periods, dates[-1])
    end_value = values[-1] or 1.0
    holdings = []
    for sym in sorted(set(contrib) | set(end_shares)):
        qty = end_shares.get(sym, 0.0)
        px = prices[sym].at(dates[-1]) if sym in prices else None
        value = qty * px * fx.get(sym, 1.0) if px is not None else None
        in_window = [d for d in prices[sym].dates if dates[0] <= d <= dates[-1]] if sym in prices else []
        price_return = (
            prices[sym].closes[in_window[-1]] / prices[sym].closes[in_window[0]] - 1 if len(in_window) >= 2 else None
        )
        holdings.append({
            "ticker": sym,
            "shares": qty,
            "value": _round(value, 2),
            "weight": _round(value / end_value, 6) if value is not None else None,
            "price_return": _round(price_return),
            "contribution": _round(contrib.get(sym)),
        })
    holdings.sort(key=lambda h: -(h["contribution"] or 0.0))

    return {
        "start": dates[0].isoformat(),
        "end": dates[-1].isoformat(),
        "series": series,
        "stats": {**stats, "beta": beta, "correlation": corr, "excess_return": excess},
        "benchmark_stats": bench_stats,
        "period_returns": period_returns(dates, index),
        "benchmark_period_returns": period_returns(dates, bench_index) if bench_index else None,
        "holdings": holdings,
        "unpriced": sorted(unpriced),
        "message": None,
    }


def _empty(message: str) -> dict:
    return {
        "start": None, "end": None, "series": [], "stats": None, "benchmark_stats": None,
        "period_returns": None, "benchmark_period_returns": None, "holdings": [], "unpriced": [],
        "message": message,
    }
