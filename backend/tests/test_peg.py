import pytest
from app.routers.portfolio import compute_peg

pytestmark = pytest.mark.unit


def test_peg_normal():
    # P/E = 20, growth = 10% → PEG = 2.0
    assert compute_peg(pe=20.0, eps_growth_3y=10.0) == pytest.approx(2.0)


def test_peg_undervalued():
    # P/E = 15, growth = 20% → PEG = 0.75
    assert compute_peg(pe=15.0, eps_growth_3y=20.0) == pytest.approx(0.75)


def test_peg_none_when_pe_negative():
    assert compute_peg(pe=-5.0, eps_growth_3y=10.0) is None


def test_peg_none_when_growth_zero():
    assert compute_peg(pe=20.0, eps_growth_3y=0.0) is None


def test_peg_none_when_growth_negative():
    assert compute_peg(pe=20.0, eps_growth_3y=-3.0) is None


def test_peg_none_when_pe_none():
    assert compute_peg(pe=None, eps_growth_3y=10.0) is None


def test_peg_none_when_growth_none():
    assert compute_peg(pe=20.0, eps_growth_3y=None) is None


def test_peg_none_when_pe_zero():
    assert compute_peg(pe=0.0, eps_growth_3y=10.0) is None


def test_peg_rounds_to_two_decimals():
    # P/E = 10, growth = 3 → 3.333... rounds to 3.33
    result = compute_peg(pe=10.0, eps_growth_3y=3.0)
    assert result == pytest.approx(3.33, abs=0.005)
