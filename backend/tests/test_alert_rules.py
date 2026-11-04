"""Unit tests for alert rule validation and evaluation (pure; no DB)."""
from datetime import date

import pytest

from app.services.alert_rules import RuleParamError, evaluate, validate_params

pytestmark = pytest.mark.unit


def test_validation_fills_defaults_and_rejects_bad_params():
    assert validate_params("ma_cross", {}) == {"window": 200, "direction": "below"}
    assert validate_params("price_above", {"price": 10}) == {"price": 10.0}
    with pytest.raises(RuleParamError, match="price"):
        validate_params("price_above", {"price": -1})
    with pytest.raises(RuleParamError, match="window"):
        validate_params("ma_cross", {"window": 100})
    with pytest.raises(RuleParamError, match="Unknown alert kind"):
        validate_params("moon", {})


def test_level_rule_fires_on_the_transition_only():
    p = {"price": 100}
    first = evaluate("price_above", p, {"price": 101}, None, ticker="AAPL")
    assert first.fire and first.condition  # already true at creation: fires once
    assert first.title == "AAPL above 100.00"
    assert "101.00" in first.message
    stays = evaluate("price_above", p, {"price": 105}, first.state, ticker="AAPL")
    assert not stays.fire  # still above: quiet
    falls = evaluate("price_above", p, {"price": 99}, stays.state, ticker="AAPL")
    assert not falls.fire and not falls.condition
    again = evaluate("price_above", p, {"price": 100.5}, falls.state, ticker="AAPL")
    assert again.fire  # re-armed after going false


def test_price_below_and_small_prices():
    ev = evaluate("price_below", {"price": 0.2}, {"price": 0.15}, None, ticker="DOGE-USD")
    assert ev.fire and ev.title == "DOGE-USD below 0.2"


def test_no_data_keeps_state_and_does_not_fire():
    ev = evaluate("price_above", {"price": 1}, None, {"active": True}, ticker="X")
    assert ev.condition is None and not ev.fire and ev.state == {"active": True}


def test_daily_move_fires_once_per_day_and_rearms_next_day():
    p = {"pct": 5}
    d1 = evaluate("daily_move", p, {"price": 90, "change_pct": -6.2}, None, ticker="NVDA", today=date(2026, 11, 3))
    assert d1.fire and d1.title == "NVDA down 6.2% today"
    d1b = evaluate("daily_move", p, {"price": 89, "change_pct": -7.0}, d1.state, ticker="NVDA", today=date(2026, 11, 3))
    assert not d1b.fire
    d2 = evaluate("daily_move", p, {"price": 95, "change_pct": 5.5}, d1b.state, ticker="NVDA", today=date(2026, 11, 4))
    assert d2.fire and "up 5.5%" in d2.title
    assert evaluate("daily_move", p, {"price": 95, "change_pct": None}, d2.state, ticker="NVDA").condition is None


def test_ma_cross_below():
    p = {"window": 200, "direction": "below"}
    ev = evaluate("ma_cross", p, {"close": 95, "sma": 100, "date": "2026-11-03"}, None, ticker="MSFT")
    assert ev.fire and ev.title == "MSFT closed below its 200-day average"
    assert "on 2026-11-03" in ev.message
    assert not evaluate("ma_cross", p, {"close": 105, "sma": 100}, None, ticker="MSFT").fire


def test_regime_change_records_baseline_then_fires_on_change():
    base = evaluate("regime_change", {"to": "any"}, {"regime": "Bull"}, None, ticker="BTC-USD")
    assert not base.fire and base.state == {"regime": "Bull"}
    same = evaluate("regime_change", {"to": "any"}, {"regime": "Bull"}, base.state, ticker="BTC-USD")
    assert not same.fire
    flip = evaluate("regime_change", {"to": "any"}, {"regime": "Bear"}, same.state, ticker="BTC-USD")
    assert flip.fire and flip.title == "BTC-USD regime: Bull → Bear"


def test_regime_change_to_a_specific_regime():
    s = {"regime": "Bull"}
    to_side = evaluate("regime_change", {"to": "Bear"}, {"regime": "Sideways"}, s, ticker="X")
    assert not to_side.fire  # changed, but not into Bear
    to_bear = evaluate("regime_change", {"to": "Bear"}, {"regime": "Bear"}, to_side.state, ticker="X")
    assert to_bear.fire


def test_verdict_change_needs_a_new_run_with_a_different_verdict():
    base = evaluate("verdict_change", {}, {"run_id": "r1", "verdict": "hold"}, None, ticker="AAPL")
    assert not base.fire
    same_verdict = evaluate("verdict_change", {}, {"run_id": "r2", "verdict": "hold"}, base.state, ticker="AAPL")
    assert not same_verdict.fire
    changed = evaluate("verdict_change", {}, {"run_id": "r3", "verdict": "sell", "analysis_date": "2026-11-03"},
                       same_verdict.state, ticker="AAPL")
    assert changed.fire and changed.title == "AAPL AI verdict: HOLD → SELL"
    assert changed.data["run_id"] == "r3"


def test_portfolio_drawdown():
    ev = evaluate("portfolio_drawdown", {"pct": 10}, {"drawdown": -0.123, "peak_date": "2026-09-01"}, None,
                  portfolio_name="Core")
    assert ev.fire and ev.title == "Core is 12.3% below its peak"
    assert not evaluate("portfolio_drawdown", {"pct": 10}, {"drawdown": -0.05}, None).fire


def test_position_weight_fires_for_newly_oversized_holdings_only():
    p = {"pct": 25}
    first = evaluate("position_weight", p, {"weights": {"NVDA": 0.3, "AAPL": 0.2}}, None, portfolio_name="Core")
    assert first.fire and first.title == "NVDA now over 25% of Core"
    same = evaluate("position_weight", p, {"weights": {"NVDA": 0.32, "AAPL": 0.2}}, first.state, portfolio_name="Core")
    assert not same.fire
    more = evaluate("position_weight", p, {"weights": {"NVDA": 0.3, "AAPL": 0.27}}, same.state, portfolio_name="Core")
    assert more.fire and more.data["new"] == ["AAPL"]
