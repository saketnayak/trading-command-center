"""Unit tests for the dividend income maths (pure; no DB)."""
from datetime import date, timedelta

import pytest

from app.services.income_calc import analyse, calendar, projection

pytestmark = pytest.mark.unit
TODAY = date(2026, 11, 5)


def quarterly(start: date, n: int, amount: float, raise_every: int = 0, raise_by: float = 0.0):
    out, a = [], amount
    for i in range(n):
        if raise_every and i and i % raise_every == 0:
            a += raise_by
        out.append((start + timedelta(days=91 * i), a))
    return out


def test_quarterly_payer_forward_ttm_and_next_dates():
    divs = quarterly(date(2024, 11, 20), 8, 0.83)  # 2024-11-20 … 2026-08-12
    info = analyse(divs + [(date(2027, 1, 1), 99.0)], TODAY)  # a future-dated row is ignored
    assert info.frequency == "quarterly" and info.payments_per_year == 4
    assert info.forward_per_share == pytest.approx(0.83 * 4)
    assert info.last_ex_date == date(2024, 11, 20) + timedelta(days=91 * 7)
    assert all(TODAY < d <= TODAY + timedelta(days=365) for d in info.next_ex_dates)
    assert len(info.next_ex_dates) == 4


def test_monthly_payer_and_special_dividend_does_not_inflate_forward():
    monthly = [(date(2025, 11, 28) + timedelta(days=30 * i), 0.27) for i in range(12)]
    info = analyse(monthly + [(date(2026, 10, 20), 5.0)], TODAY)  # one special payout
    assert info.frequency == "monthly"
    assert info.forward_per_share == pytest.approx(0.27 * 12)
    assert info.ttm_per_share == pytest.approx(0.27 * 12 + 5.0, abs=0.3)


def test_suspended_and_non_payers():
    info = analyse(quarterly(date(2022, 1, 10), 6, 0.5), TODAY)  # last paid mid-2023
    assert info.suspended and info.forward_per_share == 0 and info.next_ex_dates == ()
    none = analyse([], TODAY)
    assert none.frequency is None and none.forward_per_share == 0


def test_five_year_growth():
    divs = [(date(2020, 11, 1) + timedelta(days=91 * i), 1.0 if i < 8 else 1.0 * 1.1 ** ((i - 4) // 4)) for i in range(24)]
    info = analyse(divs, TODAY)
    assert info.growth_5y is not None and info.growth_5y > 0
    assert analyse(quarterly(date(2024, 1, 1), 12, 1.0), TODAY).growth_5y is None  # not 5 years of history


def test_calendar_buckets_twelve_months():
    info = analyse(quarterly(date(2025, 2, 20), 8, 1.0), TODAY)
    cal = calendar([("MSFT", info, 9.1)], TODAY)
    assert len(cal) == 12 and cal[0]["month"] == "2026-11" and cal[-1]["month"] == "2027-10"
    assert sum(m["amount"] for m in cal) == pytest.approx(9.1 * len(info.next_ex_dates))
    assert all(p["ticker"] == "MSFT" for m in cal for p in m["payments"])


def test_projection_reinvestment_compounds_at_the_yield():
    p = projection(annual_income=400, portfolio_value=10_000, growth=0.05, years=10)
    assert p["yield"] == pytest.approx(0.04) and p["growth"] == pytest.approx(0.05)
    assert p["years"][0] == {"year": 0, "without_drip": 400.0, "with_drip": 400.0}
    assert p["years"][10]["without_drip"] == pytest.approx(400 * 1.05 ** 10, abs=0.01)
    assert p["years"][10]["with_drip"] == pytest.approx(400 * 1.05 ** 10 * 1.04 ** 10, abs=0.01)
    assert projection(100, 1000, 0.9)["growth"] == 0.15  # capped
    assert projection(100, 1000, None)["growth"] == 0.0


def test_growth_is_not_skewed_by_payment_timing():
    """AAPL's real record seen on 2026-11-05, just before its November ex-date: a
    calendar-window TTM would hold 3 payments now and 5 five years ago (≈ −0.2%)."""
    amounts = {2020: [0.205], 2021: [0.205, 0.22, 0.22, 0.22], 2022: [0.22, 0.23, 0.23, 0.23], 2023: [0.23, 0.24, 0.24, 0.24],
               2024: [0.24, 0.25, 0.25, 0.25], 2025: [0.25, 0.26, 0.26, 0.26], 2026: [0.26, 0.27, 0.27]}
    months = {1: [11], 4: [2, 5, 8, 11], 3: [2, 5, 8]}
    divs = [(date(y, m, 8), a) for y, row in amounts.items() for m, a in zip(months[len(row)], row)]
    info = analyse(divs, date(2026, 11, 5))
    assert info.growth_5y == pytest.approx((1.06 / 0.85) ** (1 / 5) - 1, abs=0.002)  # ≈ +4.5% a year
