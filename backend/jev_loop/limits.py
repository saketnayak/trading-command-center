"""The hard risk caps. A session may lower them, never raise them."""

from __future__ import annotations

from dataclasses import dataclass, fields, replace


@dataclass(frozen=True)
class Limits:
    # --- risk.py hard vetoes, in dollars so they mean the same on any asset ---
    max_position_usd: float = 50.0
    max_daily_loss_usd: float = 25.0
    max_drawdown_pct: float = 0.05
    max_order_notional_usd: float = 25.0
    max_inventory_age_s: float = 900.0
    # Age of the market data we decide on, measured when the decision is made
    # (fetch time plus the Jev round trip). How long ago the venue's book last
    # changed is reported separately as book_age_s and never vetoed: a quiet
    # book (Alpaca's crypto book can sit unchanged for minutes) is not stale data.
    max_stale_data_age_s: float = 5.0
    max_api_errors: int = 5
    max_decision_latency_ms: float = 2000.0
    max_leverage: float = 1.0  # spot/cash only, never overridable

    # --- ladder.py ---
    low_confidence_threshold: float = 0.50
    reduce_size_factor: float = 0.5

    # --- pricing.py (Avellaneda-Stoikov) ---
    as_gamma: float = 0.10
    as_kappa: float = 1.5
    as_horizon_s: float = 60.0

    # --- execution ---
    tick_seconds: float = 2.0
    jev_interval_s: float = 6.0  # minimum spacing between Jev calls; the pacer widens it on 429s
    jev_answer_ttl_s: float = 12.0  # decide on the last Jev answer for at most this long
    rest_ticks: int = 3
    quote_notional_usd: float = 20.0
    directional_notional_usd: float = 20.0


class LimitOverrideError(ValueError):
    pass


# Caps a session may tighten (lower). Anything not listed here is fixed.
LOWERABLE_LIMITS = {
    "max_position_usd",
    "max_daily_loss_usd",
    "max_drawdown_pct",
    "max_order_notional_usd",
    "max_inventory_age_s",
    "max_stale_data_age_s",
    "max_api_errors",
    "max_decision_latency_ms",
    "quote_notional_usd",
    "directional_notional_usd",
    "jev_answer_ttl_s",
}
_MAX_TICK_SECONDS = 60.0
_JEV_INTERVAL_RANGE = (2.0, 60.0)


def validate_limit_overrides(overrides: dict | None) -> Limits:
    """Return Limits with per-session overrides applied. Refuses any value
    that loosens a cap, touches a fixed field, or is not a positive number."""
    defaults = Limits()
    if not overrides:
        return defaults
    known = {f.name for f in fields(Limits)}
    applied = {}
    for name, value in overrides.items():
        if name not in known:
            raise LimitOverrideError(f"unknown limit '{name}'")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise LimitOverrideError(f"'{name}' must be a positive number")
        if name == "tick_seconds":
            if not defaults.tick_seconds <= value <= _MAX_TICK_SECONDS:
                raise LimitOverrideError(
                    f"tick_seconds must be between {defaults.tick_seconds} and {_MAX_TICK_SECONDS}"
                )
        elif name == "jev_interval_s":
            lo, hi = _JEV_INTERVAL_RANGE
            if not lo <= value <= hi:
                raise LimitOverrideError(f"jev_interval_s must be between {lo} and {hi}")
        elif name not in LOWERABLE_LIMITS:
            raise LimitOverrideError(f"'{name}' is fixed and cannot be overridden")
        elif value > getattr(defaults, name):
            raise LimitOverrideError(
                f"'{name}' can only be lowered (max {getattr(defaults, name)}), got {value}"
            )
        applied[name] = int(value) if name == "max_api_errors" else float(value)
    return replace(defaults, **applied)
