"""Calibration: does 80% mean 80%? Brier score + reliability table over
up/down direction calls, scored against the realised move N ticks later."""

from __future__ import annotations

import math


def pair_predictions(ticks: list[dict], horizon: int = 5) -> list[tuple[float, int]]:
    """(Jev's direction confidence, was the call right). Neutral calls and
    ticks without an outcome price or without a move are skipped."""
    pairs = []
    for i, t in enumerate(ticks):
        direction, conf = t.get("direction"), t.get("direction_conf")
        if direction not in ("up", "down") or conf is None:
            continue
        j = i + horizon
        if j >= len(ticks):
            continue
        start, end = t.get("mid"), ticks[j].get("mid")
        if start is None or end is None or end == start:
            continue
        pairs.append((float(conf), 1 if (end > start) == (direction == "up") else 0))
    return pairs


def brier_score(pairs: list[tuple[float, int]]) -> float:
    if not pairs:
        return float("nan")
    return sum((p - y) ** 2 for p, y in pairs) / len(pairs)


def reliability_table(pairs: list[tuple[float, int]], n_bins: int = 10) -> list[dict]:
    bins: list[list[tuple[float, int]]] = [[] for _ in range(n_bins)]
    for p, y in pairs:
        bins[min(n_bins - 1, int(p * n_bins))].append((p, y))
    rows = []
    for i, b in enumerate(bins):
        rows.append(
            {
                "bin": f"{i / n_bins:.1f}-{(i + 1) / n_bins:.1f}",
                "n": len(b),
                "mean_predicted": sum(p for p, _ in b) / len(b) if b else None,
                "empirical": sum(y for _, y in b) / len(b) if b else None,
            }
        )
    return rows


def calibration_report(ticks: list[dict], horizon: int = 5) -> dict:
    """JSON-safe summary for the API (NaN becomes None)."""
    pairs = pair_predictions(ticks, horizon=horizon)
    score = brier_score(pairs)
    return {
        "horizon": horizon,
        "n": len(pairs),
        "brier": None if math.isnan(score) else round(score, 6),
        "bins": reliability_table(pairs),
    }
