import pytest

from jev_loop.ladder import Rung, select_rung

pytestmark = pytest.mark.unit


def _rung(**kw):
    base = dict(risk_kill=False, decision_late=False, jev_down=False, decision_confidence=0.9, low_confidence_threshold=0.5)
    base.update(kw)
    return select_rung(**base)


def test_kill_wins_over_everything():
    assert _rung(risk_kill=True, decision_late=True, jev_down=True) == Rung.KILL


def test_late_beats_jev_down():
    assert _rung(decision_late=True, jev_down=True) == Rung.HOLD_LATE


def test_jev_down_routes_to_rules_only():
    assert _rung(jev_down=True, decision_confidence=None) == Rung.RULES_ONLY


def test_low_confidence_reduces():
    assert _rung(decision_confidence=0.2) == Rung.REDUCE


def test_degraded_execution_health_reduces():
    assert _rung(execution_health_score=0.4) == Rung.REDUCE


def test_healthy_runs():
    assert _rung(execution_health_score=2.7) == Rung.RUN
