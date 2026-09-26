import time

import pytest

from jev_loop.limits import Limits
from jev_loop.risk import check
from jev_loop.state import (
    InventoryState,
    apply_fill,
    approx_token_count,
    build_snapshot,
    compute_microprice,
    parse_venue_ts,
    update_vwap,
)

pytestmark = pytest.mark.unit


def _snap(prices=None, inv=None, now=None, mid=100.0, data_timestamp=None, bids=None, asks=None):
    now = now or time.time()
    return build_snapshot(
        as_of=now,
        mid=mid,
        microprice=mid,
        spread_bps=1.0,
        bid_depth=bids if bids is not None else [(99.9, 1)],
        ask_depth=asks if asks is not None else [(100.1, 1)],
        trade_prices=prices or [(now, mid)],
        trade_sides=[(now - 1, "buy")],
        inv=inv or InventoryState(equity_usd=1000.0, high_water_mark_usd=1000.0),
        data_timestamp=now if data_timestamp is None else data_timestamp,
    )


def test_snapshot_stays_under_roughly_400_tokens():
    now = time.time()
    inv = InventoryState(inventory=0.001, entry_price=99.5, position_opened_at=now - 30, equity_usd=1000.0,
                         high_water_mark_usd=1000.0, fills=3, orders_submitted=4, recent_latencies_ms=[80, 90, 75])
    prices = [(now - i, 100 + (i % 5)) for i in range(120)]
    snap = _snap(prices=prices, inv=inv, now=now, bids=[(100.1, 0.5), (100.0, 0.4), (99.9, 0.3)],
                 asks=[(100.3, 0.4), (100.4, 0.3), (100.5, 0.2)])
    assert approx_token_count(snap) < 400


def test_timestamp_discipline_ignores_future_data():
    now = time.time()
    snap = _snap(prices=[(now - 70, 100.0), (now - 10, 105.0), (now + 1000, 999_999.0)], now=now)
    assert snap["return_1m"] is not None and snap["return_1m"] < 100


def test_top3_depth_used_for_imbalance():
    snap = _snap(bids=[(99.9, 10), (99.8, 10), (99.7, 10)], asks=[(100.1, 1), (100.2, 1), (100.3, 1)])
    assert snap["imbalance"] > 0.5


def test_no_depth_gives_none_imbalance_not_fake_balance():
    assert _snap(bids=[], asks=[])["imbalance"] is None


def test_moving_prices_give_nonzero_returns_and_vol():
    now = time.time()
    prices = [(now - 60 * k, 100 + (k % 3) - 0.05 * k) for k in range(31, 0, -1)] + [(now, 101.0)]
    snap = _snap(prices=prices, now=now)
    for key in ("return_1m", "return_5m", "return_30m", "realised_vol_short", "realised_vol_medium"):
        assert snap[key] not in (None, 0.0), key


def test_missing_history_is_none():
    snap = _snap()
    assert snap["return_1m"] is None and snap["realised_vol_short"] is None


def test_vwap_counts_each_trade_once_across_overlapping_fetches():
    inv = InventoryState()
    batch = [(1.0, 100.0, 1.0), (2.0, 102.0, 1.0)]
    update_vwap(inv, batch)
    update_vwap(inv, batch)
    update_vwap(inv, batch + [(3.0, 110.0, 2.0)])
    assert inv.vwap_cum_vol == 4.0
    assert inv.vwap_cum_pv == 100 + 102 + 220


def test_drawdown_is_measured_against_real_equity():
    inv = InventoryState(equity_usd=1000.0, high_water_mark_usd=1000.0)
    apply_fill(inv, "buy", 1.0, 1000.0, time.time())
    snap = _snap(inv=inv, mid=900.0)
    assert snap["unrealised_pnl_usd"] == -100.0
    assert snap["drawdown_pct"] == pytest.approx(0.10)


def test_apply_fill_realises_pnl():
    inv = InventoryState()
    apply_fill(inv, "buy", 2.0, 100.0, 0)
    apply_fill(inv, "sell", 1.0, 110.0, 1)
    assert inv.inventory == 1.0 and inv.realised_pnl_usd == 10.0
    apply_fill(inv, "sell", 1.0, 90.0, 2)
    assert inv.inventory == 0.0 and inv.realised_pnl_usd == 0.0


# -- regression: upstream set microprice = mid ------------------------------


def test_microprice_leans_toward_the_thin_side():
    # Heavy bid, thin ask: fair value sits closer to the ask.
    mp = compute_microprice(bids=[(99.0, 9.0)], asks=[(101.0, 1.0)], fallback=100.0)
    assert mp == pytest.approx((99.0 * 1.0 + 101.0 * 9.0) / 10.0)
    assert mp > 100.0


def test_microprice_falls_back_without_a_two_sided_book():
    assert compute_microprice(bids=[], asks=[(101.0, 1.0)], fallback=100.5) == 100.5


# -- regression: upstream stamped data_timestamp = now, so stale data never vetoed --


def test_data_older_than_the_limit_trips_the_stale_data_veto():
    now = time.time()
    snap = _snap(now=now, data_timestamp=now - 6.0)
    assert snap["data_age_s"] == pytest.approx(6.0)
    snap.update(mid=100.0, inventory=0.0, daily_loss_usd=0.0, position_age_s=0.0)
    verdict = check(snap, 10.0, Limits(), 0, 50.0)
    assert not verdict.ok and "stale" in verdict.veto


def test_book_age_is_reported_separately_from_data_age():
    now = time.time()
    inv = InventoryState(equity_usd=1000.0, high_water_mark_usd=1000.0)
    snap = build_snapshot(as_of=now, mid=100.0, microprice=100.0, spread_bps=1.0, bid_depth=[(99.9, 1)],
                          ask_depth=[(100.1, 1)], trade_prices=[(now, 100.0)], trade_sides=[], inv=inv,
                          data_timestamp=now, book_timestamp=now - 150.0)
    assert snap["data_age_s"] == 0.0 and snap["book_age_s"] == pytest.approx(150.0)


def test_parse_venue_ts_keeps_nanosecond_venue_time():
    assert parse_venue_ts("2026-09-24T21:44:30.980346366Z") == pytest.approx(1790286270.980346, abs=1e-3)
