import pytest

from jev_loop.limits import Limits, LimitOverrideError, validate_limit_overrides
from jev_loop.strategy import StrategyThresholds, ThresholdOverrideError, validate_threshold_overrides

pytestmark = pytest.mark.unit


def test_no_overrides_gives_defaults():
    assert validate_limit_overrides(None) == Limits()
    assert validate_threshold_overrides({}) == StrategyThresholds()


def test_a_cap_can_be_lowered():
    assert validate_limit_overrides({"max_position_usd": 20.0}).max_position_usd == 20.0


def test_a_cap_can_never_be_raised():
    with pytest.raises(LimitOverrideError):
        validate_limit_overrides({"max_position_usd": 5_000.0})


def test_leverage_is_not_overridable():
    with pytest.raises(LimitOverrideError):
        validate_limit_overrides({"max_leverage": 1.0})


def test_unknown_limit_is_rejected():
    with pytest.raises(LimitOverrideError):
        validate_limit_overrides({"yolo": 1})


def test_tick_seconds_can_only_slow_down():
    assert validate_limit_overrides({"tick_seconds": 5.0}).tick_seconds == 5.0
    with pytest.raises(LimitOverrideError):
        validate_limit_overrides({"tick_seconds": 0.5})


def test_non_positive_cap_is_rejected():
    with pytest.raises(LimitOverrideError):
        validate_limit_overrides({"max_daily_loss_usd": 0})


def test_threshold_override_is_applied():
    assert validate_threshold_overrides({"toxic_flow_pull_threshold": 0.4}).toxic_flow_pull_threshold == 0.4


@pytest.mark.parametrize("override", [{"toxic_flow_pull_threshold": 1.5}, {"quote_env_full_score": 7}, {"nope": 1}])
def test_bad_threshold_override_is_rejected(override):
    with pytest.raises(ThresholdOverrideError):
        validate_threshold_overrides(override)
