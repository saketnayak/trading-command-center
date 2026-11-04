"""Unit tests for the pure risk engine (no DB, no network)."""
import math
from datetime import date

import numpy as np
import pytest

from app.services.risk_calc import (
    StressScenario,
    compute_risk,
    concentration,
    monte_carlo,
    stress_test,
)

pytestmark = pytest.mark.unit

rng = np.random.default_rng(0)
MARKET = rng.normal(0.0005, 0.01, 500)


def _risk(cols: dict[str, np.ndarray], weights: dict[str, float], bench=MARKET, value=10_000.0):
    syms = sorted(cols)
    return compute_risk(symbols=syms, returns=np.column_stack([cols[s] for s in syms]),
                        weights=weights, benchmark_returns=bench, portfolio_value=value)


def test_single_holding_equal_to_market_has_beta_one():
    out = _risk({"AAA": MARKET.copy()}, {"AAA": 1.0})
    assert out["stats"]["beta"] == pytest.approx(1.0, abs=1e-3)
    assert out["stats"]["correlation"] == pytest.approx(1.0, abs=1e-3)
    assert out["stats"]["volatility"] == pytest.approx(np.std(MARKET, ddof=1) * math.sqrt(252), rel=1e-3)
    assert out["holdings"][0]["risk_share"] == pytest.approx(1.0)


def test_var_and_cvar_are_historical_left_tail():
    r = np.linspace(-0.05, 0.05, 101)  # 5th percentile = -0.045
    out = _risk({"AAA": r}, {"AAA": 1.0}, bench=None, value=1000)
    assert out["stats"]["var_95"] == pytest.approx(0.045, abs=1e-6)
    tail = r[r <= -0.045]
    assert out["stats"]["cvar_95"] == pytest.approx(-tail.mean(), abs=1e-6)
    assert out["stats"]["var_95_value"] == pytest.approx(45.0, abs=1e-3)
    assert out["stats"]["beta"] is None


def test_risk_share_sums_to_one_and_flags_the_volatile_holding():
    calm = rng.normal(0, 0.002, 500)
    wild = rng.normal(0, 0.03, 500)
    out = _risk({"CALM": calm, "WILD": wild}, {"CALM": 0.8, "WILD": 0.2})
    shares = {h["ticker"]: h["risk_share"] for h in out["holdings"]}
    assert sum(shares.values()) == pytest.approx(1.0, abs=1e-3)
    assert shares["WILD"] > 0.9  # 20% of value, almost all of the risk
    assert out["holdings"][0]["ticker"] == "WILD"  # sorted by risk share


def test_highly_correlated_holdings_form_a_cluster():
    base = rng.normal(0, 0.01, 500)
    a = base + rng.normal(0, 0.001, 500)
    b = base + rng.normal(0, 0.001, 500)
    c = rng.normal(0, 0.01, 500)
    out = _risk({"A": a, "B": b, "C": c}, {"A": 0.4, "B": 0.35, "C": 0.25})
    assert len(out["clusters"]) == 1
    cluster = out["clusters"][0]
    assert cluster["tickers"] == ["A", "B"]
    assert cluster["combined_weight"] == pytest.approx(0.75)
    assert out["top_pairs"][0]["a"] in ("A", "B") and out["top_pairs"][0]["correlation"] > 0.95
    assert out["correlation"]["tickers"] == ["A", "B", "C"]  # by weight
    assert out["correlation"]["matrix"][0][0] == pytest.approx(1.0)


def test_concentration():
    c = concentration({"A": 0.5, "B": 0.25, "C": 0.25})
    assert c["hhi"] == pytest.approx(0.375)
    assert c["effective_holdings"] == pytest.approx(2.67, abs=0.01)
    assert c["top1_weight"] == 0.5 and c["top5_weight"] == 1.0


def test_max_drawdown_of_current_weights():
    r = np.array([0.10, -0.50, 0.20, 0.0] + [0.0] * 30)
    out = _risk({"AAA": r}, {"AAA": 1.0}, bench=None)
    assert out["stats"]["max_drawdown"] == pytest.approx(-0.5)


def test_monte_carlo_is_deterministic_and_ordered():
    a = monte_carlo(MARKET)
    b = monte_carlo(MARKET)
    assert a == b
    t = a["terminal"]
    assert t["p5"] < t["p25"] < t["p50"] < t["p75"] < t["p95"]
    assert a["fan"][0]["day"] == 0 and a["fan"][0]["p50"] == 0
    assert a["fan"][-1]["day"] == 252
    assert 0 <= a["prob_loss_20"] <= a["prob_loss_10"] <= a["prob_loss"] <= 1


def test_monte_carlo_needs_some_history():
    assert monte_carlo(np.array([0.01] * 10)) is None


def test_stress_uses_actual_moves_then_beta_then_market():
    sc = (StressScenario("x", "X", date(2022, 1, 3), date(2022, 10, 12), -0.25, ""),)
    out = stress_test(
        weights={"OLD": 0.5, "NEW": 0.3, "UNK": 0.2},
        window_returns={"x": {"OLD": -0.40, "NEW": None, "UNK": None}},
        sp500_window_returns={"x": -0.20},
        betas_vs_sp500={"NEW": 1.5, "UNK": None},
        portfolio_value=1000,
        scenarios=sc,
    )[0]
    # OLD actual -40%; NEW beta 1.5 × -20%; UNK market -20%
    assert out["portfolio_return"] == pytest.approx(0.5 * -0.40 + 0.3 * -0.30 + 0.2 * -0.20)
    assert out["portfolio_impact"] == pytest.approx(-330.0)
    assert out["market_source"] == "stored prices"
    assert out["replayed_weight"] == pytest.approx(0.5)
    methods = {leg["ticker"]: leg["method"] for leg in out["worst"]}
    assert methods == {"OLD": "actual", "NEW": "beta", "UNK": "market"}


def test_stress_falls_back_to_index_move_outside_stored_history():
    sc = (StressScenario("gfc", "GFC", date(2007, 10, 9), date(2009, 3, 9), -0.5678, ""),)
    out = stress_test(weights={"A": 1.0}, window_returns={"gfc": {"A": None}},
                      sp500_window_returns={"gfc": None}, betas_vs_sp500={"A": 0.5},
                      portfolio_value=100, scenarios=sc)[0]
    assert out["market_source"] == "S&P 500 index levels"
    assert out["portfolio_return"] == pytest.approx(0.5 * -0.5678)


def test_beta_estimate_never_loses_more_than_everything():
    sc = (StressScenario("gfc", "GFC", date(2007, 10, 9), date(2009, 3, 9), -0.5678, ""),)
    out = stress_test(weights={"HOT": 0.5, "CALM": 0.5}, window_returns={"gfc": {}},
                      sp500_window_returns={"gfc": None}, betas_vs_sp500={"HOT": 2.0, "CALM": 0.5},
                      portfolio_value=100, scenarios=sc)[0]
    legs = {leg["ticker"]: leg["return"] for leg in out["worst"]}
    assert legs["HOT"] == -1.0
    assert out["portfolio_return"] == pytest.approx(0.5 * -1.0 + 0.5 * 0.5 * -0.5678, abs=1e-4)
