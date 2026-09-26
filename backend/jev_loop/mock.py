"""A plausible, persistent, clearly-labelled stand-in for Jev.

Answers derive from real snapshot fields plus a slow-drifting latent, so a
demo looks internally consistent. It answers with random numbers, so a
session on the mock is always shadow: it never places orders.
"""

from __future__ import annotations

import math
import random


class MockDecisionModel:
    name = "MOCK"
    model = "mock-jev-0.1"

    def __init__(self, seed: int | None = None, max_position_usd: float = 50.0):
        self._rng = random.Random(seed)
        self._max_position_usd = max_position_usd
        self._regime_latent = self._rng.uniform(-1, 1)
        self._direction_latent = self._rng.uniform(-1, 1)

    def _drift(self, latent: float, pull: float = 0.04) -> float:
        latent += self._rng.uniform(-0.16, 0.16) - pull * latent
        return max(-1.0, min(1.0, latent))

    def ask(self, state: dict, questions: dict) -> tuple[dict, dict]:
        self._regime_latent = self._drift(self._regime_latent)
        self._direction_latent = self._drift(self._direction_latent)

        imbalance = state.get("imbalance") or 0.0
        toxic = max(0.0, min(1.0, 0.5 + imbalance * 0.6 + self._rng.uniform(-0.15, 0.15)))
        stressed = max(0.0, min(1.0, 0.3 + self._rng.uniform(-0.2, 0.3)))

        env_score, env_probs = _score_from_latent(0.5 - stressed + self._rng.uniform(-0.3, 0.3), 4)

        # Pressure from position *value* against the dollar cap, so the same
        # rule means the same thing on an $85k coin and a $30 stock.
        position_usd = abs(state.get("inventory") or 0.0) * (state.get("mid") or 0.0)
        ratio = min(1.0, position_usd / self._max_position_usd) if self._max_position_usd > 0 else 0.0
        pressure_score, pressure_probs = _score_from_latent(ratio * 2 - 1, 4)

        fill_ratio = state.get("fill_ratio")
        fill_ratio = 1.0 if fill_ratio is None else fill_ratio
        latencies = state.get("last_10_latencies_ms") or []
        avg_latency = sum(latencies) / len(latencies) if latencies else 100.0
        slippage = state.get("last_10_slippage_bps") or []
        avg_slip = sum(abs(s) for s in slippage) / len(slippage) if slippage else 0.0
        health_latent = (
            (fill_ratio - 0.5) * 1.5
            - (state.get("reject_count") or 0) * 0.3
            - max(0.0, (avg_latency - 300) / 500)
            - avg_slip / 20
            + self._rng.uniform(-0.2, 0.2)
        )
        health_score, health_probs = _score_from_latent(max(-1.0, min(1.0, health_latent)), 4)

        answers = {
            "regime": _choice_answer(
                _softmax_from_latent(self._regime_latent, ["trending", "mean_reverting", "high_vol", "crisis"])
            ),
            "direction": _choice_answer(_softmax_from_latent(self._direction_latent, ["up", "down", "neutral"])),
            "toxic_flow": {"type": "noul", "noul": round(toxic, 4)},
            "liquidity_stressed": {"type": "noul", "noul": round(stressed, 4)},
            "quote_environment": _score_answer(env_score, env_probs, ["Do not quote", "Marginal", "Standard", "Excellent"]),
            "inventory_pressure": _score_answer(pressure_score, pressure_probs, ["None", "Mild", "Skew hard", "Reduce now"]),
            "execution_health": _score_answer(health_score, health_probs, ["Broken", "Degraded", "Normal", "Optimal"]),
        }
        return answers, {"route": self.name, "model": self.model, "latency_ms": None, "usage": {}}


def _softmax_from_latent(latent: float, options: list[str]) -> dict:
    scores = {opt: math.exp(4.6 * latent * (1 if i == 0 else -0.5)) for i, opt in enumerate(options)}
    total = sum(scores.values())
    return {opt: v / total for opt, v in scores.items()}


def _confidence(probs: dict) -> float:
    n = len(probs)
    if n <= 1:
        return 1.0
    return max(0.0, min(1.0, (n * max(probs.values()) - 1) / (n - 1)))


def _choice_answer(probs: dict) -> dict:
    return {
        "type": "choice",
        "choice": max(probs, key=probs.get),
        "probabilities": {k: round(v, 4) for k, v in probs.items()},
        "confidence": round(_confidence(probs), 4),
    }


def _score_from_latent(latent: float, n_levels: int) -> tuple[float, list[float]]:
    centre = max(0.0, min(n_levels - 1, (latent + 1) / 2 * (n_levels - 1)))
    weights = [math.exp(-((i - centre) ** 2) / 0.42) for i in range(n_levels)]
    total = sum(weights)
    probs = [w / total for w in weights]
    return sum(i * p for i, p in enumerate(probs)), probs


def _score_answer(score: float, probs: list[float], levels: list[str]) -> dict:
    return {
        "type": "score",
        "score": round(score, 4),
        "legend": {str(i): lvl for i, lvl in enumerate(levels)},
        "probabilities": {str(i): round(p, 4) for i, p in enumerate(probs)},
        "confidence": round(_confidence({str(i): p for i, p in enumerate(probs)}), 4),
    }
