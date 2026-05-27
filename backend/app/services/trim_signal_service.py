"""Trim-signal scoring — pure function over already-loaded portfolio holding data.

Composes AI verdict, Markov regime, PEG ratio, unrealized P&L, and position weight
into a per-holding trim level with human-readable reasons. No I/O, no DB, no async.
"""
from typing import Literal, Optional
from pydantic import BaseModel

from app.config import settings

TrimLevel = Literal["none", "watch", "consider_trim", "strong_trim"]


class TrimSignal(BaseModel):
    level: TrimLevel
    score: int
    reasons: list[str]


def score_trim_signal(
    *,
    ticker: str,
    unrealized_pnl_pct: Optional[float],
    current_verdict: Optional[str],
    previous_verdict: Optional[str],
    regime: Optional[str],
    regime_signal: Optional[float],
    peg: Optional[float],
    portfolio_weight_pct: Optional[float],
) -> TrimSignal:
    """Score a single holding. All inputs may be None — rules short-circuit cleanly."""
    normal: list[str] = []
    strong: list[str] = []

    # R1 — Big gain
    if unrealized_pnl_pct is not None and unrealized_pnl_pct >= settings.trim_gain_threshold_pct:
        normal.append(f"Up {unrealized_pnl_pct:.0f}% from basis")

    # R2 — Verdict softened (BUY → HOLD or SELL)
    if (
        current_verdict is not None
        and previous_verdict is not None
        and previous_verdict == "BUY"
        and current_verdict in ("HOLD", "SELL")
    ):
        normal.append(f"AI conviction weakened ({previous_verdict} → {current_verdict})")

    # R3 — Sell verdict (strong)
    if current_verdict == "SELL":
        strong.append("AI verdict: SELL")

    # R4 — Bear regime (strong)
    if regime == "Bear":
        sig = f"{regime_signal:+.2f}" if regime_signal is not None else "—"
        strong.append(f"Markov regime: Bear (signal {sig})")

    # R5 — Sideways with weakening signal
    if (
        regime == "Sideways"
        and regime_signal is not None
        and regime_signal < settings.trim_regime_signal_weak_threshold
    ):
        normal.append(f"Regime softening (Sideways, signal {regime_signal:+.2f})")

    # R6 — Overvalued (PEG > threshold)
    if peg is not None and peg > settings.trim_peg_threshold:
        normal.append(f"Overvalued (PEG {peg:.1f})")

    # R7 — Concentration
    if (
        portfolio_weight_pct is not None
        and portfolio_weight_pct > settings.trim_concentration_threshold_pct
    ):
        normal.append(f"Concentration: {portfolio_weight_pct:.0f}% of portfolio")

    all_reasons = strong + normal  # strong reasons listed first

    if not all_reasons:
        return TrimSignal(level="none", score=0, reasons=["No analysis yet"])

    if strong:
        level: TrimLevel = "strong_trim"
    elif len(normal) >= 3:
        level = "strong_trim"
    elif len(normal) == 2:
        level = "consider_trim"
    else:
        level = "watch"

    score = min(len(strong) * 40 + len(normal) * 15, 100)
    return TrimSignal(level=level, score=score, reasons=all_reasons)
