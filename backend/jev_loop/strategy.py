"""Tunable strategy thresholds and the apply_strategy hook.

This is the harness, not an edge: the shipped defaults are the generic
numbers the upstream video ran. Sessions may override thresholds; the
hard caps in limits.py stay out of reach of anything here.
"""

from __future__ import annotations

from dataclasses import dataclass, fields, replace


@dataclass(frozen=True)
class StrategyThresholds:
    toxic_flow_pull_threshold: float = 0.6  # toxic_flow > this -> PULL_QUOTES
    liquidity_stressed_widen_threshold: float = 0.7  # liquidity_stressed > this -> WIDEN
    quote_env_full_score: float = 2.0  # env >= this and confident -> QUOTE_BOTH_SIDES
    quote_env_full_confidence: float = 0.80
    quote_env_wide_score: float = 1.0  # env >= this -> QUOTE_WIDE
    inventory_pressure_max_score: float = 3.0  # denominator for the skew
    direction_confidence_threshold: float = 0.55  # direction.confidence above this -> take the leg


THRESHOLDS = StrategyThresholds()


class ThresholdOverrideError(ValueError):
    pass


_PROBABILITY_FIELDS = {
    "toxic_flow_pull_threshold",
    "liquidity_stressed_widen_threshold",
    "quote_env_full_confidence",
    "direction_confidence_threshold",
}
_MAX_SCORE = 3.0  # every score question has four levels, 0..3


def validate_threshold_overrides(overrides: dict | None) -> StrategyThresholds:
    if not overrides:
        return THRESHOLDS
    known = {f.name for f in fields(StrategyThresholds)}
    applied = {}
    for name, value in overrides.items():
        if name not in known:
            raise ThresholdOverrideError(f"unknown threshold '{name}'")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ThresholdOverrideError(f"'{name}' must be a number")
        upper = 1.0 if name in _PROBABILITY_FIELDS else _MAX_SCORE
        lower_ok = value > 0 if name == "inventory_pressure_max_score" else value >= 0
        if not lower_ok or value > upper:
            raise ThresholdOverrideError(f"'{name}' must be within 0..{upper}")
        applied[name] = float(value)
    return replace(THRESHOLDS, **applied)


def apply_strategy(action, answers: dict, snapshot: dict, limits) -> object:
    """Strategy hook, called after compose_action(). Default: no change.
    Return a different Action to override, or Action(STAND_DOWN, ...) to
    veto. risk.py still runs afterwards and has the final word."""
    return action
