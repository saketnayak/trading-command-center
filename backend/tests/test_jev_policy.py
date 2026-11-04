import pytest

from jev_loop.limits import Limits
from jev_loop.policy import (
    KILL,
    PULL_QUOTES,
    QUOTE_BOTH_SIDES,
    QUOTE_WIDE,
    STAND_DOWN,
    WIDEN,
    compose_action,
    fallback_action,
    inventory_skew,
)
from jev_loop.strategy import StrategyThresholds

pytestmark = pytest.mark.unit

L = Limits()

BASE_SNAPSHOT = dict(
    drawdown_pct=0.01,
    inventory=0.0,
    daily_loss_usd=0.0,
    position_age_s=0.0,
    data_age_s=0.1,
    leverage=1.0,
    spread_bps=4.0,
    imbalance=0.0,
)

BASE_ANSWERS = {
    "toxic_flow": {"noul": 0.2},
    "liquidity_stressed": {"noul": 0.1},
    "quote_environment": {"score": 2.3, "confidence": 0.84},
    "inventory_pressure": {"score": 1.1},
    "direction": {"choice": "neutral", "confidence": 0.9},
}


def test_kill_on_drawdown_breach():
    assert compose_action(BASE_ANSWERS, dict(BASE_SNAPSHOT, drawdown_pct=0.2), L).kind == KILL


def test_pull_quotes_on_toxic_flow():
    assert compose_action(dict(BASE_ANSWERS, toxic_flow={"noul": 0.75}), BASE_SNAPSHOT, L).kind == PULL_QUOTES


def test_widen_on_liquidity_stress():
    assert compose_action(dict(BASE_ANSWERS, liquidity_stressed={"noul": 0.85}), BASE_SNAPSHOT, L).kind == WIDEN


def test_quote_both_sides_matches_article_example():
    assert compose_action(BASE_ANSWERS, BASE_SNAPSHOT, L).kind == QUOTE_BOTH_SIDES


def test_quote_wide_below_full_confidence():
    answers = dict(BASE_ANSWERS, quote_environment={"score": 2.3, "confidence": 0.5})
    assert compose_action(answers, BASE_SNAPSHOT, L).kind == QUOTE_WIDE


def test_stand_down_below_quoting_floor():
    answers = dict(BASE_ANSWERS, quote_environment={"score": 0.5, "confidence": 0.9})
    assert compose_action(answers, BASE_SNAPSHOT, L).kind == STAND_DOWN


def test_directional_leg_only_when_confident_and_quoting():
    action = compose_action(dict(BASE_ANSWERS, direction={"choice": "up", "confidence": 0.9}), BASE_SNAPSHOT, L)
    assert action.kind == QUOTE_BOTH_SIDES and action.direction_leg == "up"
    low = compose_action(dict(BASE_ANSWERS, direction={"choice": "up", "confidence": 0.1}), BASE_SNAPSHOT, L)
    assert low.direction_leg is None


def test_directional_leg_never_fires_on_pull():
    answers = dict(BASE_ANSWERS, toxic_flow={"noul": 0.9}, direction={"choice": "up", "confidence": 0.99})
    action = compose_action(answers, BASE_SNAPSHOT, L)
    assert action.kind == PULL_QUOTES and action.direction_leg is None


def test_per_session_thresholds_change_the_decision():
    strict = StrategyThresholds(toxic_flow_pull_threshold=0.1)
    assert compose_action(BASE_ANSWERS, BASE_SNAPSHOT, L, thresholds=strict).kind == PULL_QUOTES


def test_inventory_skew_direction():
    assert inventory_skew(3.0, 3.0, inventory=0.01) < 0
    assert inventory_skew(3.0, 3.0, inventory=-0.01) > 0
    assert inventory_skew(3.0, 3.0, inventory=0.0) == 0.0


def test_fallback_action_never_touches_jev():
    import inspect

    assert "answers" not in inspect.signature(fallback_action).parameters
    assert fallback_action(BASE_SNAPSHOT, L).kind in (KILL, STAND_DOWN, WIDEN, QUOTE_WIDE)


def test_fallback_stands_down_on_wide_spread():
    assert fallback_action(dict(BASE_SNAPSHOT, spread_bps=40.0), L).kind == STAND_DOWN
