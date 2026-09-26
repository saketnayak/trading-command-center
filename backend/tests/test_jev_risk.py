import pytest

from jev_loop.limits import Limits
from jev_loop.risk import check

pytestmark = pytest.mark.unit

L = Limits()

OK = dict(
    drawdown_pct=0.01,
    inventory=0.0005,
    mid=40_000.0,  # $20 position, under the $50 cap
    daily_loss_usd=1.0,
    position_age_s=10.0,
    data_age_s=0.2,
    leverage=1.0,
)


def test_ok_case_passes():
    v = check(OK, 20.0, L, 0, 90.0)
    assert v.ok and v.veto is None and not v.kill


@pytest.mark.parametrize(
    "override",
    [
        {"drawdown_pct": 0.5},
        {"inventory": 1.0, "mid": 85_000.0},
        {"inventory": 0.01, "mid": 10_000.0},
        {"daily_loss_usd": 999.0},
        {"leverage": 5.0},
    ],
)
def test_hard_breaches_kill(override):
    v = check(dict(OK, **override), 20.0, L, 0, 90.0)
    assert not v.ok and v.kill


def test_api_error_streak_kills():
    v = check(OK, 20.0, L, api_error_streak=99, decision_latency_ms=90.0)
    assert not v.ok and v.kill


@pytest.mark.parametrize(
    "kwargs",
    [
        dict(snapshot=dict(OK, position_age_s=99_999.0)),
        dict(snapshot=dict(OK, data_age_s=999.0)),
        dict(order_notional_usd=10_000.0),
        dict(decision_latency_ms=99_999.0),
    ],
)
def test_soft_breaches_veto_without_kill(kwargs):
    args = dict(snapshot=OK, order_notional_usd=20.0, limits=L, api_error_streak=0, decision_latency_ms=90.0)
    args.update(kwargs)
    v = check(**args)
    assert not v.ok and not v.kill


def test_risk_never_reads_jev_answers():
    import inspect

    assert "answers" not in inspect.signature(check).parameters
