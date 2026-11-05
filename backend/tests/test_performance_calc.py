"""Unit tests for the pure performance engine (no DB, no network)."""
from datetime import date, timedelta

import pytest

from app.services.performance_calc import (
    HoldingsPeriod,
    _minus_months,
    compute_performance,
    period_returns,
)

pytestmark = pytest.mark.unit


def _days(start: date, n: int) -> list[date]:
    """n consecutive weekdays from start."""
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _series(days: list[date], prices: list[float]) -> dict[date, float]:
    return dict(zip(days, prices))


D = _days(date(2026, 1, 5), 6)  # Mon Jan 5 .. Mon Jan 12


def test_single_holding_return_matches_price_return():
    closes = {"AAA": _series(D, [100, 110, 99, 99, 108.9, 121])}
    out = compute_performance(
        periods=[HoldingsPeriod(date.min, {"AAA": 10})], closes=closes, fx={},
        benchmark=None, start=D[0], end=D[-1],
    )
    assert out["stats"]["total_return"] == pytest.approx(0.21)
    assert [p["value"] for p in out["series"]] == [1000, 1100, 990, 990, 1089, 1210]
    # peak 110 → trough 99
    assert out["stats"]["max_drawdown"] == pytest.approx(-0.1)
    assert out["stats"]["max_drawdown_peak"] == D[1].isoformat()
    assert out["stats"]["max_drawdown_trough"] == D[2].isoformat()
    assert out["stats"]["best_day"]["date"] == D[5].isoformat()  # 108.9 → 121 is +11.1%


def test_adding_shares_is_a_cash_flow_not_a_gain():
    # Price is flat, but the second snapshot doubles the position: value doubles, return stays 0.
    closes = {"AAA": _series(D, [50] * 6)}
    periods = [HoldingsPeriod(D[0], {"AAA": 10}), HoldingsPeriod(D[3], {"AAA": 20})]
    out = compute_performance(periods=periods, closes=closes, fx={}, benchmark=None, start=D[0], end=D[-1])
    assert out["stats"]["total_return"] == pytest.approx(0.0)
    assert out["series"][-1]["value"] == 1000
    assert out["series"][0]["value"] == 500


def test_return_uses_previous_close_holdings():
    # A buy at day 2's close does not earn day 2's move.
    closes = {"AAA": _series(D, [100, 100, 200, 200, 200, 200]), "BBB": _series(D, [100] * 6)}
    periods = [HoldingsPeriod(D[0], {"BBB": 10}), HoldingsPeriod(D[2], {"AAA": 10})]
    out = compute_performance(periods=periods, closes=closes, fx={}, benchmark=None, start=D[0], end=D[-1])
    assert out["stats"]["total_return"] == pytest.approx(0.0)


def test_two_holdings_value_weighted_and_contributions():
    closes = {"AAA": _series(D[:2], [100, 110]), "BBB": _series(D[:2], [100, 100])}
    out = compute_performance(
        periods=[HoldingsPeriod(date.min, {"AAA": 3, "BBB": 1})], closes=closes, fx={},
        benchmark=None, start=D[0], end=D[1],
    )
    # 75% weight in AAA at +10% → +7.5%
    assert out["stats"]["total_return"] == pytest.approx(0.075)
    contrib = {h["ticker"]: h["contribution"] for h in out["holdings"]}
    assert contrib["AAA"] == pytest.approx(0.075)
    assert contrib["BBB"] == pytest.approx(0.0)


def test_fx_factor_weights_but_does_not_change_local_return():
    closes = {"EUR1": _series(D[:2], [100, 120]), "USD1": _series(D[:2], [100, 100])}
    out = compute_performance(
        periods=[HoldingsPeriod(date.min, {"EUR1": 1, "USD1": 1})], closes=closes,
        fx={"EUR1": 2.0, "USD1": 1.0}, benchmark=None, start=D[0], end=D[1],
    )
    # EUR1 is 2/3 of the value → 2/3 × 20%
    assert out["stats"]["total_return"] == pytest.approx(2 / 3 * 0.2, abs=1e-6)


def test_benchmark_identical_series_has_beta_one_and_zero_excess():
    prices = [100, 101, 99, 102, 104, 103]
    closes = {"AAA": _series(D, prices)}
    out = compute_performance(
        periods=[HoldingsPeriod(date.min, {"AAA": 1})], closes=closes, fx={},
        benchmark=_series(D, prices), start=D[0], end=D[-1],
    )
    assert out["stats"]["beta"] == pytest.approx(1.0)
    assert out["stats"]["correlation"] == pytest.approx(1.0)
    assert out["stats"]["excess_return"] == pytest.approx(0.0)
    assert out["series"][-1]["benchmark_index"] == out["series"][-1]["index"]


def test_benchmark_calendar_folds_weekend_crypto_moves_into_monday():
    fri, sat, sun, mon = date(2026, 1, 9), date(2026, 1, 10), date(2026, 1, 11), date(2026, 1, 12)
    closes = {"BTC-USD": {fri: 100, sat: 150, sun: 120, mon: 110}}
    out = compute_performance(
        periods=[HoldingsPeriod(date.min, {"BTC-USD": 1})], closes=closes, fx={},
        benchmark={fri: 50, mon: 50}, start=fri, end=mon,
    )
    assert [p["date"] for p in out["series"]] == [fri.isoformat(), mon.isoformat()]
    assert out["stats"]["total_return"] == pytest.approx(0.10)


def test_missing_prices_are_reported_not_silently_zeroed():
    closes = {"AAA": _series(D, [100] * 6), "GHOST": {}}
    out = compute_performance(
        periods=[HoldingsPeriod(date.min, {"AAA": 1, "GHOST": 5})], closes=closes, fx={},
        benchmark=None, start=D[0], end=D[-1],
    )
    assert out["unpriced"] == ["GHOST"]
    assert out["stats"]["total_return"] == pytest.approx(0.0)


def test_stale_forward_fill_is_bounded():
    # One price, then nothing for weeks: the holding must not stay "priced" forever.
    long_days = _days(date(2026, 1, 5), 20)
    closes = {"AAA": {long_days[0]: 100}, "BBB": _series(long_days, [100] * 20)}
    out = compute_performance(
        periods=[HoldingsPeriod(date.min, {"AAA": 1, "BBB": 1})], closes=closes, fx={},
        benchmark=None, start=long_days[0], end=long_days[-1],
    )
    assert "AAA" in out["unpriced"]


def test_no_priced_holdings_returns_message():
    out = compute_performance(
        periods=[HoldingsPeriod(date.min, {"X": 1})], closes={"X": {}}, fx={},
        benchmark=None, start=D[0], end=D[-1],
    )
    assert out["series"] == []
    assert out["message"]


def test_period_returns_none_when_window_precedes_series():
    dates = _days(date(2026, 3, 2), 30)
    index = [100 * (1.01 ** i) for i in range(30)]
    pr = period_returns(dates, index)
    assert pr["1W"] is not None
    assert pr["1Y"] is None and pr["YTD"] is None


def test_minus_months_clamps_month_end():
    assert _minus_months(date(2026, 3, 31), 1) == date(2026, 2, 28)
    assert _minus_months(date(2026, 1, 15), 1) == date(2025, 12, 15)
    assert _minus_months(date(2028, 2, 29), 12) == date(2027, 2, 28)


def test_annualised_return_only_for_a_year_or_more():
    short = compute_performance(
        periods=[HoldingsPeriod(date.min, {"AAA": 1})], closes={"AAA": _series(D, [100, 101, 102, 103, 104, 105])},
        fx={}, benchmark=None, start=D[0], end=D[-1],
    )
    assert short["stats"]["annualised_return"] is None

    year = [date(2025, 1, 2) + timedelta(days=i) for i in range(0, 400, 7)]
    long_closes = {"AAA": {d: 100 * (1 + i / 100) for i, d in enumerate(year)}}
    out = compute_performance(
        periods=[HoldingsPeriod(date.min, {"AAA": 1})], closes=long_closes, fx={},
        benchmark=None, start=year[0], end=year[-1],
    )
    assert out["stats"]["annualised_return"] is not None
