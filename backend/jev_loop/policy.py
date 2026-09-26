"""compose_action(): the policy engine. Code, not Jev. Reads the seven
answers already given this tick plus the strategy thresholds."""

from __future__ import annotations

from dataclasses import dataclass

from .limits import Limits
from .strategy import THRESHOLDS, StrategyThresholds, apply_strategy

KILL = "KILL"
PULL_QUOTES = "PULL_QUOTES"
WIDEN = "WIDEN"
QUOTE_BOTH_SIDES = "QUOTE_BOTH_SIDES"
QUOTE_WIDE = "QUOTE_WIDE"
STAND_DOWN = "STAND_DOWN"

QUOTING_ACTIONS = (QUOTE_BOTH_SIDES, QUOTE_WIDE, WIDEN)


@dataclass
class Action:
    kind: str
    reason: str
    skew: float = 0.0
    direction_leg: str | None = None  # "up" | "down" | None


def inventory_skew(pressure_score: float, max_score: float, inventory: float) -> float:
    """Signed skew in [-1, 1]: negative leans to selling a long, positive to buying back a short."""
    if inventory == 0:
        return 0.0
    magnitude = max(0.0, min(1.0, pressure_score / max_score))
    return -magnitude if inventory > 0 else magnitude


def compose_action(
    answers: dict, snapshot: dict, limits: Limits, thresholds: StrategyThresholds | None = None
) -> Action:
    t = thresholds or THRESHOLDS
    action = _compose_from_thresholds(answers, snapshot, limits, t)
    return apply_strategy(action, answers, snapshot, limits)


def _compose_from_thresholds(answers: dict, snapshot: dict, limits: Limits, t: StrategyThresholds) -> Action:
    if snapshot["drawdown_pct"] > limits.max_drawdown_pct:
        return Action(KILL, reason=f"drawdown {snapshot['drawdown_pct']:.2%} over limit")

    toxic = answers["toxic_flow"]["noul"]
    if toxic > t.toxic_flow_pull_threshold:
        return Action(PULL_QUOTES, reason=f"toxic flow {toxic:.2f}")

    stressed = answers["liquidity_stressed"]["noul"]
    if stressed > t.liquidity_stressed_widen_threshold:
        return Action(WIDEN, reason=f"liquidity stressed {stressed:.2f}")

    q = answers["quote_environment"]
    if q["score"] >= t.quote_env_full_score and q["confidence"] > t.quote_env_full_confidence:
        skew = inventory_skew(
            answers["inventory_pressure"]["score"], t.inventory_pressure_max_score, snapshot["inventory"]
        )
        action = Action(QUOTE_BOTH_SIDES, skew=skew, reason=f"env {q['score']:.2f} conf {q['confidence']:.2f}")
    elif q["score"] >= t.quote_env_wide_score:
        action = Action(QUOTE_WIDE, reason=f"env {q['score']:.2f}")
    else:
        return Action(STAND_DOWN, reason=f"env {q['score']:.2f} below quoting floor")

    direction = answers["direction"]
    if direction["choice"] != "neutral" and direction["confidence"] > t.direction_confidence_threshold:
        action.direction_leg = direction["choice"]
    return action


def fallback_action(snapshot: dict, limits: Limits) -> Action:
    """Jev-free policy for the RULES_ONLY rung: spread and imbalance only."""
    if snapshot["drawdown_pct"] > limits.max_drawdown_pct:
        return Action(KILL, reason="drawdown breach (rules-only)")
    if snapshot["spread_bps"] > 15.0:
        return Action(STAND_DOWN, reason="spread too wide for rules-only quoting")
    imbalance = snapshot.get("imbalance")
    if imbalance is not None and abs(imbalance) > 0.6:
        return Action(WIDEN, reason="book imbalance too high for rules-only quoting")
    return Action(QUOTE_WIDE, reason="rules-only: spread and imbalance acceptable")
