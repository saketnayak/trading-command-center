"""Pure order planner: turns an Action into the orders a tick would place.

The runner executes the plan (or, in shadow mode, only logs it). The
account is cash-only spot, so nothing here ever plans a sell of more than
is held: upstream always sent a sell quote when flat, which the venue
rejects, and the exception could orphan the buy it had just placed.
"""

from __future__ import annotations

from dataclasses import dataclass

from .assets import AssetSpec, floor_qty, size_order
from .policy import QUOTE_BOTH_SIDES, QUOTE_WIDE, WIDEN, Action

WIDE_FACTOR = 0.001  # WIDEN / QUOTE_WIDE quote 10 bps outside the A-S prices


@dataclass(frozen=True)
class PlannedOrder:
    purpose: str  # "quote_bid" | "quote_ask" | "leg"
    side: str  # "buy" | "sell"
    type: str  # "limit" | "market"
    qty: float
    limit_price: float | None = None


def plan_orders(
    action: Action,
    *,
    inventory: float,
    bid_px: float,
    ask_px: float,
    quote_notional: float,
    directional_notional: float,
    spec: AssetSpec,
    max_buy_usd: float | None = None,
) -> list[PlannedOrder]:
    """`max_buy_usd` is the room left under the position cap; buys that would
    not fit are dropped (the quote first gets the room, then the leg)."""
    if action.kind not in (QUOTE_BOTH_SIDES, QUOTE_WIDE, WIDEN):
        return []

    if action.kind in (QUOTE_WIDE, WIDEN):
        q_bid, q_ask = bid_px * (1 - WIDE_FACTOR), ask_px * (1 + WIDE_FACTOR)
    else:
        q_bid, q_ask = bid_px, ask_px

    available = max(inventory, 0.0)
    plan: list[PlannedOrder] = []

    def sellable(target: float, price: float) -> float:
        qty = floor_qty(min(target, available), spec)
        return qty if qty > 0 and qty * price >= spec.min_notional_usd else 0.0

    leg: PlannedOrder | None = None
    if action.direction_leg == "up":
        leg = PlannedOrder("leg", "buy", "market", size_order(directional_notional, ask_px, spec))
    elif action.direction_leg == "down":
        # A directional exit outranks the resting ask, so it reserves inventory first.
        qty = sellable(size_order(directional_notional, bid_px, spec), bid_px)
        if qty:
            leg = PlannedOrder("leg", "sell", "market", qty)
            available -= qty

    plan.append(PlannedOrder("quote_bid", "buy", "limit", size_order(quote_notional, q_bid, spec), round(q_bid, 2)))
    ask_qty = sellable(size_order(quote_notional, q_ask, spec), q_ask)
    if ask_qty:
        plan.append(PlannedOrder("quote_ask", "sell", "limit", ask_qty, round(q_ask, 2)))
    if leg:
        plan.append(leg)
    if max_buy_usd is None:
        return plan

    budget = max_buy_usd
    kept = []
    for order in plan:
        if order.side == "buy":
            notional = order.qty * (order.limit_price or ask_px)
            if notional > budget:
                continue
            budget -= notional
        kept.append(order)
    return kept
