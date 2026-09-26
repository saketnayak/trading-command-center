"""The deterministic state snapshot. Never calls Jev.

Timestamp discipline: every field is computed only from points at or
before `as_of`. `data_timestamp` must be the venue's own timestamp on the
book/quote, not the local clock, or the stale-data veto can never fire.

Honest degradation: with no L2 depth the caller passes empty depth lists
and `imbalance` comes back None rather than a fake "balanced" 0.0.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime


def parse_venue_ts(raw: str) -> float:
    """RFC 3339 venue timestamp (Alpaca sends nanoseconds) -> epoch seconds."""
    raw = raw.replace("Z", "+00:00")
    if "." in raw:
        head, rest = raw.split(".", 1)
        frac, tz = rest, ""
        for sep in ("+", "-"):
            if sep in rest:
                frac, tz = rest.split(sep, 1)
                tz = sep + tz
                break
        raw = f"{head}.{frac[:6]}{tz}"
    return datetime.fromisoformat(raw).timestamp()


def compute_microprice(
    bids: list[tuple[float, float]], asks: list[tuple[float, float]], fallback: float
) -> float:
    """Size-weighted mid of the top level: leans toward the thinner side,
    where the next trade is more likely to move price."""
    if not bids or not asks:
        return fallback
    (bp, bs), (ap, az) = bids[0], asks[0]
    if bs + az <= 0 or bp <= 0 or ap <= 0:
        return fallback
    return (bp * az + ap * bs) / (bs + az)


def _pct_return(prices: list[tuple[float, float]], now: float, lookback_s: float) -> float | None:
    past = [p for ts, p in prices if ts <= now - lookback_s]
    current = [p for ts, p in prices if ts <= now]
    if not past or not current or past[-1] == 0:
        return None
    return (current[-1] - past[-1]) / past[-1]


def _realised_vol(
    prices: list[tuple[float, float]], now: float, window_s: float, step_s: float = 60.0
) -> float | None:
    """Stdev of log returns resampled onto a fixed grid inside the window.
    None when there is not enough real history yet."""
    pts = sorted((ts, p) for ts, p in prices if ts <= now and p > 0)
    if not pts:
        return None
    n_steps = int(window_s // step_s)
    grid = [now - k * step_s for k in range(n_steps, -1, -1)]
    sampled: list[float] = []
    j = 0
    last = None
    for g in grid:
        while j < len(pts) and pts[j][0] <= g:
            last = pts[j][1]
            j += 1
        if last is not None:
            sampled.append(last)
    if len(sampled) < 3:
        return None
    rets = [math.log(b / a) for a, b in zip(sampled, sampled[1:])]
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(max(var, 0.0))


@dataclass
class InventoryState:
    """The loop's own bookkeeping, carried tick to tick."""

    inventory: float = 0.0
    entry_price: float = 0.0
    position_opened_at: float | None = None
    realised_pnl_usd: float = 0.0
    high_water_mark_usd: float = 0.0
    equity_usd: float = 0.0  # starting equity, seeded from the account
    fills: int = 0
    orders_submitted: int = 0
    orders_rejected: int = 0
    recent_latencies_ms: list[float] = field(default_factory=list)
    recent_slippage_bps: list[float] = field(default_factory=list)
    vwap_cum_pv: float = 0.0
    vwap_cum_vol: float = 0.0
    vwap_last_trade_ts: float = 0.0


def update_vwap(inv: InventoryState, trades: list[tuple[float, float, float]]) -> None:
    """Fold (ts, price, size) trades newer than the last one seen into the
    session VWAP, so overlapping fetch windows never double count."""
    newest = inv.vwap_last_trade_ts
    for ts, price, size in trades:
        if ts <= inv.vwap_last_trade_ts or price <= 0 or size <= 0:
            continue
        inv.vwap_cum_pv += price * size
        inv.vwap_cum_vol += size
        newest = max(newest, ts)
    inv.vwap_last_trade_ts = newest


def record_fill_slippage(inv: InventoryState, expected_price: float, fill_price: float, side: str) -> None:
    """Signed bps; positive means worse than expected."""
    if expected_price <= 0:
        return
    sign = 1.0 if side == "buy" else -1.0
    inv.recent_slippage_bps.append(round(sign * (fill_price - expected_price) / expected_price * 10_000, 2))
    inv.recent_slippage_bps = inv.recent_slippage_bps[-10:]


def apply_fill(inv: InventoryState, side: str, qty: float, price: float, ts: float) -> None:
    """Fold one broker-confirmed fill into inventory and realised PnL
    (average-cost accounting)."""
    if qty <= 0 or price <= 0:
        return
    signed = qty if side == "buy" else -qty
    old = inv.inventory
    new = old + signed
    if old == 0 or (old > 0) == (signed > 0):
        inv.entry_price = (inv.entry_price * abs(old) + price * qty) / abs(new) if new else 0.0
        if old == 0:
            inv.position_opened_at = ts
    else:
        closed = min(abs(old), qty)
        direction = 1.0 if old > 0 else -1.0
        inv.realised_pnl_usd += (price - inv.entry_price) * closed * direction
        if abs(new) < 1e-12:
            new = 0.0
            inv.entry_price = 0.0
            inv.position_opened_at = None
        elif (new > 0) != (old > 0):
            inv.entry_price = price
            inv.position_opened_at = ts
    inv.inventory = new
    inv.fills += 1


def build_snapshot(
    *,
    as_of: float,
    mid: float,
    microprice: float,
    spread_bps: float,
    bid_depth: list[tuple[float, float]],
    ask_depth: list[tuple[float, float]],
    trade_prices: list[tuple[float, float]],
    trade_sides: list[tuple[float, str]],
    inv: InventoryState,
    data_timestamp: float,
    has_depth: bool = True,
    book_timestamp: float | None = None,
) -> dict:
    bid_sz = sum(sz for _, sz in bid_depth[:3])
    ask_sz = sum(sz for _, sz in ask_depth[:3])
    imbalance = round((bid_sz - ask_sz) / (bid_sz + ask_sz), 4) if bid_sz + ask_sz > 0 else None

    window = [s for ts, s in trade_sides if as_of - 30.0 <= ts <= as_of]
    buys = sum(1 for s in window if s == "buy")
    aggressive_buy_ratio = buys / len(window) if window else 0.5

    unrealised = (mid - inv.entry_price) * inv.inventory if inv.inventory else 0.0
    equity = inv.equity_usd + inv.realised_pnl_usd + unrealised
    peak = max(inv.high_water_mark_usd, equity)
    drawdown_pct = (peak - equity) / peak if peak > 0 else 0.0
    position_age_s = (
        as_of - inv.position_opened_at if inv.inventory and inv.position_opened_at else 0.0
    )
    fill_ratio = min(1.0, inv.fills / inv.orders_submitted) if inv.orders_submitted else 1.0
    vwap = inv.vwap_cum_pv / inv.vwap_cum_vol if inv.vwap_cum_vol > 0 else mid

    return {
        "as_of": as_of,
        "mid": mid,
        "microprice": round(microprice, 6),
        "vwap": round(vwap, 6),
        "return_1m": _pct_return(trade_prices, as_of, 60),
        "return_5m": _pct_return(trade_prices, as_of, 300),
        "return_30m": _pct_return(trade_prices, as_of, 1800),
        "spread_bps": spread_bps,
        "has_depth": has_depth,
        "depth_levels_available": min(len(bid_depth), len(ask_depth)) if has_depth else 0,
        "bid_depth_3": [[p, s] for p, s in bid_depth[:3]],
        "ask_depth_3": [[p, s] for p, s in ask_depth[:3]],
        "imbalance": imbalance,
        "aggressive_buy_ratio": round(aggressive_buy_ratio, 4),
        "trade_intensity_per_s": round(len(window) / 30.0, 4),
        "realised_vol_short": _realised_vol(trade_prices, as_of, 300),
        "realised_vol_medium": _realised_vol(trade_prices, as_of, 1800),
        "inventory": inv.inventory,
        "unrealised_pnl_usd": round(unrealised, 4),
        "daily_loss_usd": round(max(0.0, -inv.realised_pnl_usd - unrealised), 4),
        "drawdown_pct": round(drawdown_pct, 6),
        "position_age_s": round(position_age_s, 1),
        "fill_ratio": round(fill_ratio, 4),
        "reject_count": inv.orders_rejected,
        "last_10_latencies_ms": inv.recent_latencies_ms[-10:],
        "last_10_slippage_bps": inv.recent_slippage_bps[-10:],
        "data_age_s": round(max(0.0, as_of - data_timestamp), 3),
        # when the venue's book last changed; information, not a veto
        "book_age_s": round(max(0.0, as_of - book_timestamp), 1) if book_timestamp is not None else None,
        "leverage": 1.0,
    }


def approx_token_count(snapshot: dict) -> int:
    return len(json.dumps(snapshot, default=str)) // 4
