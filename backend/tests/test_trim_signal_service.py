import pytest
from app.services.trim_signal_service import score_trim_signal, TrimSignal

pytestmark = pytest.mark.unit


def _call(**overrides):
    defaults = dict(
        ticker="AAPL",
        unrealized_pnl_pct=None,
        current_verdict=None,
        previous_verdict=None,
        regime=None,
        regime_signal=None,
        peg=None,
        portfolio_weight_pct=None,
    )
    defaults.update(overrides)
    return score_trim_signal(**defaults)


def test_all_none_returns_level_none_with_no_analysis_reason():
    result = _call()
    assert result.level == "none"
    assert result.reasons == ["No analysis yet"]
    assert result.score == 0


def test_r1_big_gain_fires_at_threshold():
    result = _call(unrealized_pnl_pct=30.0)
    assert result.level == "watch"
    assert any("Up 30% from basis" in r for r in result.reasons)


def test_r1_big_gain_does_not_fire_below_threshold():
    result = _call(unrealized_pnl_pct=29.9)
    assert result.level == "none"


def test_r2_verdict_softened_buy_to_hold():
    result = _call(current_verdict="HOLD", previous_verdict="BUY")
    assert result.level == "watch"
    assert any("AI conviction weakened (BUY → HOLD)" in r for r in result.reasons)


def test_r2_verdict_softened_buy_to_sell_fires_r2_and_r3():
    # R2 (BUY→SELL) + R3 (SELL strong) → strong_trim
    result = _call(current_verdict="SELL", previous_verdict="BUY")
    assert result.level == "strong_trim"
    assert any("AI conviction weakened" in r for r in result.reasons)
    assert any("AI verdict: SELL" in r for r in result.reasons)


def test_r2_does_not_fire_when_same_verdict():
    result = _call(current_verdict="HOLD", previous_verdict="HOLD")
    assert result.level == "none"


def test_r2_does_not_fire_when_previous_is_none():
    result = _call(current_verdict="HOLD", previous_verdict=None)
    assert result.level == "none"


def test_r3_sell_verdict_is_strong():
    result = _call(current_verdict="SELL")
    assert result.level == "strong_trim"
    assert any("AI verdict: SELL" in r for r in result.reasons)


def test_r4_bear_regime_is_strong():
    result = _call(regime="Bear", regime_signal=-0.4)
    assert result.level == "strong_trim"
    assert any("Markov regime: Bear" in r for r in result.reasons)


def test_r5_sideways_with_weak_signal_fires_watch():
    result = _call(regime="Sideways", regime_signal=-0.2)
    assert result.level == "watch"
    assert any("Regime softening" in r for r in result.reasons)


def test_r5_sideways_with_neutral_signal_does_not_fire():
    result = _call(regime="Sideways", regime_signal=0.0)
    assert result.level == "none"


def test_r6_overvalued_peg_fires():
    result = _call(peg=3.4)
    assert result.level == "watch"
    assert any("Overvalued (PEG 3.4)" in r for r in result.reasons)


def test_r6_peg_at_threshold_does_not_fire():
    result = _call(peg=3.0)
    assert result.level == "none"


def test_r7_concentration_above_threshold_fires():
    result = _call(portfolio_weight_pct=18.0)
    assert result.level == "watch"
    assert any("Concentration: 18% of portfolio" in r for r in result.reasons)


def test_r7_concentration_at_threshold_does_not_fire():
    result = _call(portfolio_weight_pct=15.0)
    assert result.level == "none"


def test_two_normal_reasons_yields_consider_trim():
    result = _call(unrealized_pnl_pct=50.0, peg=3.5)
    assert result.level == "consider_trim"
    assert len(result.reasons) == 2


def test_three_normal_reasons_yields_strong_trim():
    result = _call(unrealized_pnl_pct=50.0, peg=3.5, portfolio_weight_pct=20.0)
    assert result.level == "strong_trim"


def test_strong_reason_overrides_count():
    # Only one rule fires but it's strong (Bear regime) → strong_trim
    result = _call(regime="Bear", regime_signal=-0.5)
    assert result.level == "strong_trim"


def test_score_increases_with_reasons():
    one = _call(unrealized_pnl_pct=50.0)
    two = _call(unrealized_pnl_pct=50.0, peg=3.5)
    strong = _call(current_verdict="SELL")
    assert two.score > one.score
    assert strong.score > two.score
    assert strong.score <= 100
