"""The pure order planner: what orders a tick *would* place. The runner
executes the plan; this file pins the cash-account rules upstream broke."""

import pytest

from jev_loop.assets import resolve_symbol
from jev_loop.order_plan import plan_orders
from jev_loop.policy import KILL, PULL_QUOTES, QUOTE_BOTH_SIDES, QUOTE_WIDE, STAND_DOWN, WIDEN, Action

pytestmark = pytest.mark.unit

BTC = resolve_symbol("BTC/USD")


def _plan(kind, inventory=0.0, leg=None, bid=99_990.0, ask=100_010.0):
    return plan_orders(
        Action(kind, reason="t", direction_leg=leg),
        inventory=inventory,
        bid_px=bid,
        ask_px=ask,
        quote_notional=20.0,
        directional_notional=20.0,
        spec=BTC,
    )


def _sides(plan):
    return [(o.purpose, o.side) for o in plan]


@pytest.mark.parametrize("kind", [KILL, PULL_QUOTES, STAND_DOWN])
def test_no_orders_when_not_quoting(kind):
    assert _plan(kind) == []


def test_flat_account_quotes_only_the_bid():
    # Regression: upstream always sent a sell quote with no inventory, which a
    # cash account rejects, and the exception could orphan the buy it had just placed.
    assert _sides(_plan(QUOTE_BOTH_SIDES)) == [("quote_bid", "buy")]


def test_long_inventory_allows_the_ask_capped_at_what_is_held():
    held = 0.00015  # $15 at 100k, above the $10 floor, below the $20 quote size
    plan = _plan(QUOTE_BOTH_SIDES, inventory=held)
    ask = [o for o in plan if o.purpose == "quote_ask"]
    assert len(ask) == 1 and ask[0].qty == pytest.approx(held)


def test_dust_inventory_below_venue_minimum_is_not_quoted():
    plan = _plan(QUOTE_BOTH_SIDES, inventory=0.00001)  # $1
    assert "quote_ask" not in [o.purpose for o in plan]


def test_down_leg_is_skipped_when_flat():
    assert "leg" not in [o.purpose for o in _plan(QUOTE_BOTH_SIDES, leg="down")]


def test_down_leg_sells_no_more_than_held():
    plan = _plan(QUOTE_BOTH_SIDES, inventory=0.00012, leg="down")
    leg = [o for o in plan if o.purpose == "leg"][0]
    assert leg.side == "sell" and leg.type == "market" and leg.qty <= 0.00012


def test_up_leg_is_a_market_buy():
    leg = [o for o in _plan(QUOTE_BOTH_SIDES, leg="up") if o.purpose == "leg"][0]
    assert leg.side == "buy" and leg.type == "market"


def _touch_plan(kind, bid=99_999.0, ask=100_001.0, best_bid=99_985.0, best_ask=100_015.0, inventory=0.001):
    return {o.purpose: o.limit_price for o in plan_orders(
        Action(kind, reason="t"), inventory=inventory, bid_px=bid, ask_px=ask, quote_notional=20.0,
        directional_notional=20.0, spec=BTC, best_bid=best_bid, best_ask=best_ask)}


def test_normal_quotes_sit_inside_the_spread():
    p = _touch_plan(QUOTE_BOTH_SIDES)
    assert 99_985.0 < p["quote_bid"] < p["quote_ask"] < 100_015.0


@pytest.mark.parametrize("kind", [WIDEN, QUOTE_WIDE])
def test_wide_quotes_join_the_best_bid_and_ask(kind):
    # Regression: "wide" sat 10 bps below mid while the spread was 3 bps, so
    # the bid never filled.
    p = _touch_plan(kind)
    assert p["quote_bid"] == 99_985.0 and p["quote_ask"] == 100_015.0


def test_quotes_never_cross_the_book():
    p = _touch_plan(QUOTE_BOTH_SIDES, bid=100_020.0, ask=99_980.0)
    assert p["quote_bid"] < 100_015.0 and p["quote_ask"] > 99_985.0


def test_every_order_meets_the_venue_minimum():
    for o in _plan(QUOTE_BOTH_SIDES, inventory=0.001, leg="up"):
        px = o.limit_price or 100_000.0
        assert o.qty * px >= BTC.min_notional_usd


# -- position budget: never plan buys that would breach the position cap ----


def _budget_plan(max_buy_usd, leg="up"):
    return plan_orders(
        Action(QUOTE_BOTH_SIDES, reason="t", direction_leg=leg),
        inventory=0.0,
        bid_px=99_990.0,
        ask_px=100_010.0,
        quote_notional=20.0,
        directional_notional=20.0,
        spec=BTC,
        max_buy_usd=max_buy_usd,
    )


def test_buys_fit_inside_the_remaining_position_budget():
    assert [o.purpose for o in _budget_plan(50.0)] == ["quote_bid", "leg"]


def test_the_leg_is_dropped_when_only_the_quote_fits():
    assert [o.purpose for o in _budget_plan(30.0)] == ["quote_bid"]


def test_no_buys_when_the_budget_is_spent():
    assert _budget_plan(5.0) == []
