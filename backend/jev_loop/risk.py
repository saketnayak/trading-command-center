"""Nine hard limits, checked before every order. Never delegates to Jev."""

from __future__ import annotations

from dataclasses import dataclass

from .limits import Limits


@dataclass
class RiskVerdict:
    ok: bool
    veto: str | None = None
    kill: bool = False


def check(
    snapshot: dict,
    order_notional_usd: float,
    limits: Limits,
    api_error_streak: int,
    decision_latency_ms: float | None,
) -> RiskVerdict:
    if snapshot["drawdown_pct"] > limits.max_drawdown_pct:
        return RiskVerdict(False, "max_drawdown breached", kill=True)
    if abs(snapshot["inventory"]) * snapshot["mid"] > limits.max_position_usd:
        return RiskVerdict(False, "max_position_usd breached", kill=True)
    if snapshot["daily_loss_usd"] > limits.max_daily_loss_usd:
        return RiskVerdict(False, "max_daily_loss breached", kill=True)
    if order_notional_usd > limits.max_order_notional_usd:
        return RiskVerdict(False, "order exceeds max_order_notional_usd")
    if snapshot["inventory"] != 0 and snapshot["position_age_s"] > limits.max_inventory_age_s:
        return RiskVerdict(False, "inventory held past max_inventory_age_s")
    if snapshot["data_age_s"] > limits.max_stale_data_age_s:
        return RiskVerdict(False, "market data stale past max_stale_data_age_s")
    if api_error_streak > limits.max_api_errors:
        return RiskVerdict(False, "max_api_errors breached", kill=True)
    if decision_latency_ms is not None and decision_latency_ms > limits.max_decision_latency_ms:
        return RiskVerdict(False, "decision latency over max_decision_latency_ms")
    if snapshot.get("leverage", 1.0) > limits.max_leverage:
        return RiskVerdict(False, "max_leverage breached", kill=True)
    return RiskVerdict(True)
