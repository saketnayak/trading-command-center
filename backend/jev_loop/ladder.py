"""The five-rung fallback ladder: exactly one rung per tick."""

from __future__ import annotations

from enum import Enum


class Rung(str, Enum):
    RUN = "run"
    REDUCE = "reduce"
    HOLD_LATE = "hold_late"
    RULES_ONLY = "rules_only"
    KILL = "kill"


def select_rung(
    *,
    risk_kill: bool,
    decision_late: bool,
    jev_down: bool,
    decision_confidence: float | None,
    low_confidence_threshold: float,
    execution_health_score: float | None = None,
    execution_health_floor: float = 1.0,
) -> Rung:
    if risk_kill:
        return Rung.KILL
    if decision_late:
        return Rung.HOLD_LATE
    if jev_down:
        return Rung.RULES_ONLY
    if decision_confidence is not None and decision_confidence < low_confidence_threshold:
        return Rung.REDUCE
    if execution_health_score is not None and execution_health_score < execution_health_floor:
        return Rung.REDUCE
    return Rung.RUN
