"""The JEV Lab nine-stage loop.

    1. tick clock           (Limits.tick_seconds, default 2 s)
    2. read the book        (Alpaca market data, venue timestamps)
    3. state snapshot       (jev_loop.state, deterministic)
    4. battery              (seven Jev judgments, one call)
    5. policy               (jev_loop.policy + per-session thresholds)
    6. pricing              (jev_loop.pricing, Avellaneda-Stoikov)
    7. risk veto            (jev_loop.risk, absolute)
    8. execute              (jev_loop.order_plan; paper only, never in shadow)
    9. persist + broadcast  (the sink: DB rows and the WebSocket)

Shadow mode, or any mock decider, never sends an order: the plan is logged
with status "shadow". Fills are only ever read back from the broker.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from app.services.alpaca_paper_client import AlpacaAPIError, MarketClosedError
from app.services.jev_client import (
    JevDeadlineExceeded,
    JevDecisionError,
    JevGatewayVerificationRequired,
    MockJevClient,
    run_battery,
)
from jev_loop.assets import AssetSpec, floor_qty
from jev_loop.ladder import Rung, select_rung
from jev_loop.limits import Limits
from jev_loop.order_plan import plan_orders
from jev_loop.policy import KILL, PULL_QUOTES, STAND_DOWN, compose_action, fallback_action
from jev_loop.pricing import quote_prices
from jev_loop.risk import check as risk_check
from jev_loop.state import (
    InventoryState,
    apply_fill,
    build_snapshot,
    compute_microprice,
    parse_venue_ts,
    record_fill_slippage,
    update_vwap,
)
from jev_loop.strategy import StrategyThresholds

logger = logging.getLogger(__name__)

HISTORY_S = 2400.0  # 40 min of real prices (return_30m needs 30)
TRADE_TAPE_S = 60.0
TERMINAL_ORDER_STATES = {"filled", "canceled", "expired", "rejected", "done_for_day"}


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


@dataclass
class LoopConfig:
    session_id: str
    spec: AssetSpec
    mode: str  # "shadow" | "paper"
    limits: Limits
    thresholds: StrategyThresholds
    max_ticks: int | None
    max_duration_s: float


async def reconcile_fills(market, inv: InventoryState, seen: dict, expected_px: dict, after_iso: str, now: float):
    """Fold in only fill quantity that is new since the last read, at the
    broker's own average price. Returns (new fills, any order still working)."""
    new_fills = []
    pending = False
    for o in await market.get_own_orders(after_iso):
        oid = o.get("id")
        filled = float(o.get("filled_qty") or 0.0)
        avg = float(o.get("filled_avg_price") or 0.0)
        prev_q, prev_avg = seen.get(oid, (0.0, 0.0))
        if filled > prev_q + 1e-12 and avg > 0:
            dq = filled - prev_q
            px = (filled * avg - prev_q * prev_avg) / dq
            apply_fill(inv, o["side"], dq, px, now)
            expected = expected_px.get(o.get("client_order_id"))
            if expected:
                record_fill_slippage(inv, expected, px, o["side"])
            new_fills.append((o["side"], dq, px))
            seen[oid] = (filled, avg)
        if o.get("status") not in TERMINAL_ORDER_STATES:
            pending = True
    return new_fills, pending


async def flatten(market, spec: AssetSpec, inv: InventoryState, seen: dict, expected_px: dict,
                  after_iso: str, now: float, sleep=asyncio.sleep) -> str:
    """Cancel this session's resting orders, then market-close the position
    it built. Never sells more than the broker says is held, so it cannot
    open a short or close a position something else opened."""
    msgs = []
    try:
        msgs.append(f"cancelled {await market.cancel_own_orders()} own order(s)")
        await reconcile_fills(market, inv, seen, expected_px, after_iso, now)
        held = await market.get_position_qty()
        bot = inv.inventory
        qty = floor_qty(min(abs(bot), abs(held)), spec) if bot * held > 0 else 0.0
        if qty > 0:
            side = "sell" if bot > 0 else "buy"
            await market.submit_market_order(side, qty)
            for _ in range(5):
                _, pending = await reconcile_fills(market, inv, seen, expected_px, after_iso, now)
                if not pending:
                    break
                await sleep(0.5)
            msgs.append(f"market {side} {qty} sent, inventory now {inv.inventory:g}")
        else:
            msgs.append("nothing held to flatten")
    except (AlpacaAPIError, MarketClosedError) as exc:
        msgs.append(f"FLATTEN FAILED, close the position by hand in Alpaca: {exc}")
    return "; ".join(msgs)


class JevLoop:
    def __init__(self, cfg: LoopConfig, market, decider, sink, *, clock=time.time,
                 sleep=asyncio.sleep, monotonic=time.monotonic):
        self.cfg = cfg
        self.market = market
        self.decider = decider
        self.sink = sink
        self._clock = clock
        self._sleep = sleep
        self._monotonic = monotonic
        self.dry = cfg.mode != "paper" or getattr(decider, "is_mock", False)

        self.inv = InventoryState()
        self.fills_seen: dict = {}
        self.expected_px: dict = {}
        self.price_hist: list[tuple[float, float]] = []
        self.trade_tape: list[tuple[float, float, float, str]] = []
        self.seen_trade_ids: set = set()
        self.api_error_streak = 0
        self.reconcile_needed = False
        self.resting_kind: str | None = None
        self.resting_bid_usd = 0.0
        self.rest_counter = 0
        self.tick_no = 0
        self.route = getattr(decider, "name", None)
        self.model = getattr(decider, "model", None)
        self.cost_usd = 0.0
        self._last_mid: float | None = None
        self.session_start_iso = ""
        self.trades_since_iso = ""

    # -- summary -------------------------------------------------------------

    def summary(self, mid: float | None = None) -> dict:
        return {
            "tick_count": self.tick_no,
            "inventory": self.inv.inventory,
            "realised_pnl_usd": round(self.inv.realised_pnl_usd, 6),
            "last_mid": mid,
            "fills": self.inv.fills,
            "orders_submitted": self.inv.orders_submitted,
            "orders_rejected": self.inv.orders_rejected,
            "decision_route": self.route,
            "decision_model": self.model,
            "cost_usd": round(self.cost_usd, 8),
            "start_equity_usd": self.inv.equity_usd,
        }

    # -- lifecycle -----------------------------------------------------------

    async def run(self) -> str:
        started = self._clock()
        self.session_start_iso = iso(started - 5)
        self.trades_since_iso = iso(started - TRADE_TAPE_S)
        try:
            await self._startup(started)
            while True:
                if self.cfg.max_ticks is not None and self.tick_no >= self.cfg.max_ticks:
                    return await self._finish("completed", "tick limit reached")
                if self._clock() - started >= self.cfg.max_duration_s:
                    return await self._finish("completed", "max duration reached")
                tick_start = self._monotonic()
                killed_reason = await self.tick()
                if killed_reason:
                    await self.sink.on_status("killed", killed_reason, self.summary(self._last_mid))
                    return "killed"
                remaining = self.cfg.limits.tick_seconds - (self._monotonic() - tick_start)
                if remaining > 0:
                    await self._sleep(remaining)
        except asyncio.CancelledError:
            await self._cancel_resting()
            await self.sink.on_status("stopped", "stopped by user", self.summary(self._last_mid))
            raise
        except Exception as exc:  # noqa: BLE001 - any crash must still pull quotes
            logger.exception("jev session %s crashed", self.cfg.session_id)
            await self._cancel_resting()
            await self.sink.on_status("failed", str(exc)[:500], self.summary(self._last_mid))
            return "failed"

    async def _finish(self, status: str, reason: str) -> str:
        await self._cancel_resting()
        await self.sink.on_status(status, reason, self.summary(self._last_mid))
        return status

    async def _cancel_resting(self) -> None:
        if self.dry or not self.market.orders_placed:
            return
        try:
            await self.market.cancel_own_orders()
        except Exception:  # noqa: BLE001 - best effort
            logger.warning("jev session %s: could not cancel resting orders", self.cfg.session_id)
        self.resting_kind = None
        self.resting_bid_usd = 0.0

    async def _startup(self, now: float) -> None:
        equity = 0.0
        try:
            equity = float((await self.market.get_account()).get("equity") or 0.0)
        except AlpacaAPIError:
            pass
        if equity <= 0:
            equity = self.cfg.limits.max_position_usd  # the most this loop can ever put at risk
        self.inv.equity_usd = equity
        self.inv.high_water_mark_usd = equity
        try:
            for bar in await self.market.get_minute_bars(iso(now - HISTORY_S)):
                close_ts = parse_venue_ts(bar["t"]) + 60.0
                if close_ts <= now and float(bar.get("c", 0)) > 0:
                    self.price_hist.append((close_ts, float(bar["c"])))
        except (AlpacaAPIError, KeyError, ValueError):
            pass  # returns fill in as ticks arrive

    # -- one tick ------------------------------------------------------------

    async def tick(self) -> str | None:
        """Run one tick. Returns a reason string when the session was killed."""
        self.tick_no += 1
        now = self._clock()
        limits = self.cfg.limits

        if not self.cfg.spec.is_24_7 and not await self.market.is_market_open():
            await self._emit(now, None, action="MARKET_CLOSED", reason="market closed, prices are stale",
                             rung="hold_late", fill="-")
            return None

        # 2. read the book
        try:
            bids, asks, venue_ts = await self.market.read_top_of_book()
            recent = await self.market.get_recent_trades(self.trades_since_iso)
            self.api_error_streak = 0
        except AlpacaAPIError as exc:
            self.api_error_streak += 1
            if self.api_error_streak > limits.max_api_errors:
                fill = await self._kill(now)
                await self._emit(now, None, action=KILL, reason=f"max_api_errors breached: {exc}",
                                 rung="kill", fill=fill)
                return "max_api_errors breached"
            await self._emit(now, None, action="DATA_ERROR", reason=str(exc)[:200], rung="hold_late", fill="-")
            return None

        self._ingest_trades(recent, now)
        last_px = self.trade_tape[-1][1] if self.trade_tape else (self.price_hist[-1][1] if self.price_hist else 0.0)
        mid = (bids[0][0] + asks[0][0]) / 2 if bids and asks else last_px
        spread_bps = (asks[0][0] - bids[0][0]) / mid * 10_000 if (mid and bids and asks) else 0.0
        self._last_mid = mid
        if mid > 0:
            self.price_hist.append((now, mid))
        self.price_hist = [x for x in self.price_hist if x[0] >= now - HISTORY_S]

        # fills come from the broker, never from assumptions
        fill_notes: list[str] = []
        if self.reconcile_needed and not self.dry:
            try:
                new_fills, self.reconcile_needed = await reconcile_fills(
                    self.market, self.inv, self.fills_seen, self.expected_px, self.session_start_iso, now)
                fill_notes = [f"filled {s} {q:.8g} @ {p:,.2f}" for s, q, p in new_fills]
            except AlpacaAPIError as exc:
                self.api_error_streak += 1
                fill_notes = [f"could not read fills: {exc}"]

        # 3. snapshot
        snapshot = build_snapshot(
            as_of=now,
            mid=mid,
            microprice=compute_microprice(bids, asks, mid),
            spread_bps=spread_bps,
            bid_depth=bids,
            ask_depth=asks,
            trade_prices=self.price_hist,
            trade_sides=[(ts, side) for ts, _, _, side in self.trade_tape],
            inv=self.inv,
            data_timestamp=venue_ts if venue_ts is not None else now,
            has_depth=self.cfg.spec.has_depth,
        )
        equity_now = self.inv.equity_usd + self.inv.realised_pnl_usd + snapshot["unrealised_pnl_usd"]
        self.inv.high_water_mark_usd = max(self.inv.high_water_mark_usd, equity_now)

        # 4. battery, inside the tick budget
        budget = max(0.05, limits.tick_seconds - 0.15)
        answers, meta = None, {}
        late = jev_down = False
        try:
            answers, meta = await run_battery(self.decider, snapshot, timeout=budget)
        except JevGatewayVerificationRequired as exc:
            jev_down = True
            fill_notes.append(f"gateway needs a card on file ({exc}); switched to the mock, no more orders")
            self.decider = MockJevClient(max_position_usd=limits.max_position_usd)
            self.dry = True
        except JevDeadlineExceeded:
            late = True
        except JevDecisionError as exc:
            jev_down = True
            fill_notes.append(f"decision error: {exc}")
        if answers is not None:
            self.route, self.model = meta.get("route"), meta.get("model")
            self.cost_usd += meta.get("cost_usd") or 0.0
            if meta.get("latency_ms") is not None:
                self.inv.recent_latencies_ms = (self.inv.recent_latencies_ms + [meta["latency_ms"]])[-10:]
        elif jev_down:
            self.route, self.model = getattr(self.decider, "name", None), getattr(self.decider, "model", None)

        # 5. policy
        if late:
            action = None
        elif answers is None:
            action = fallback_action(snapshot, limits)
        else:
            action = compose_action(answers, snapshot, limits, thresholds=self.cfg.thresholds)

        rung = select_rung(
            risk_kill=snapshot["drawdown_pct"] > limits.max_drawdown_pct,
            decision_late=late,
            jev_down=jev_down,
            decision_confidence=answers["quote_environment"]["confidence"] if answers else None,
            low_confidence_threshold=limits.low_confidence_threshold,
            execution_health_score=answers["execution_health"]["score"] if answers else None,
        )

        # 6-8. pricing, risk, execution
        orders: list[dict] = []
        reason = action.reason if action else "block deadline exceeded"
        killed = None
        if rung == Rung.HOLD_LATE:
            await self._cancel_resting()  # never leave quotes resting on stale state
        elif rung == Rung.KILL or action.kind == KILL:
            rung = Rung.KILL
            killed = reason
            fill_notes.append(await self._kill(now))
        else:
            factor = limits.reduce_size_factor if rung == Rung.REDUCE else 1.0
            quote_usd = limits.quote_notional_usd * factor
            leg_usd = limits.directional_notional_usd * factor
            verdict = risk_check(snapshot, max(quote_usd, leg_usd), limits, self.api_error_streak,
                                 meta.get("latency_ms"))
            if not verdict.ok:
                reason = f"vetoed: {verdict.veto}"
                if verdict.kill:
                    rung = Rung.KILL
                    killed = verdict.veto
                    fill_notes.append(await self._kill(now))
                else:
                    await self._cancel_resting()
            elif action.kind in (PULL_QUOTES, STAND_DOWN):
                await self._cancel_resting()
            else:
                sigma = snapshot["realised_vol_short"] or 0.001
                bid_px, ask_px = quote_prices(mid=mid, inventory=snapshot["inventory"], sigma=sigma,
                                              gamma=limits.as_gamma, kappa=limits.as_kappa,
                                              time_left_s=limits.as_horizon_s)
                position_usd = abs(self.inv.inventory) * mid
                plan = plan_orders(
                    action, inventory=self.inv.inventory, bid_px=bid_px, ask_px=ask_px,
                    quote_notional=quote_usd, directional_notional=leg_usd, spec=self.cfg.spec,
                    max_buy_usd=max(0.0, limits.max_position_usd - position_usd - self.resting_bid_usd),
                )
                orders = await self._execute(plan, action.kind, mid)

        await self._emit(now, snapshot, action=action.kind if action else "HOLD_LATE", reason=reason,
                         rung=rung.value, fill="; ".join(fill_notes) or "-", answers=answers, meta=meta,
                         orders=orders, direction_leg=action.direction_leg if action else None)
        return killed

    def _ingest_trades(self, recent: list[dict], now: float) -> None:
        new = []
        for t in recent:
            tid = t.get("i")
            if tid in self.seen_trade_ids:
                continue
            self.seen_trade_ids.add(tid)
            ts = parse_venue_ts(t["t"])
            if ts > now:
                continue  # nothing stamped after as_of gets in
            new.append((ts, float(t["p"]), float(t["s"]), "buy" if t.get("tks") == "B" else "sell"))
        if new:
            self.trades_since_iso = iso(max(ts for ts, *_ in new))
        self.trade_tape = [x for x in self.trade_tape + new if x[0] >= now - TRADE_TAPE_S]
        if len(self.seen_trade_ids) > 5000:
            self.seen_trade_ids = {t.get("i") for t in recent}
        update_vwap(self.inv, [(ts, p, sz) for ts, p, sz, _ in new])

    async def _execute(self, plan, kind: str, mid: float) -> list[dict]:
        quotes = [o for o in plan if o.purpose != "leg"]
        legs = [o for o in plan if o.purpose == "leg"]
        self.rest_counter += 1
        requote = (
            self.resting_kind is None
            or self.rest_counter >= self.cfg.limits.rest_ticks
            or kind != self.resting_kind
        )
        to_send = (quotes if requote else []) + legs

        if self.dry:
            if requote:
                self.resting_kind, self.rest_counter = kind, 0
            return [self._order_dict(o, "shadow") for o in to_send]

        if requote:
            await self._cancel_resting()
            self.rest_counter = 0
        out = []
        for o in to_send:
            try:
                self.inv.orders_submitted += 1
                if o.type == "limit":
                    sent = await self.market.submit_limit_order(o.side, o.qty, o.limit_price)
                    expected = o.limit_price
                else:
                    sent = await self.market.submit_market_order(o.side, o.qty)
                    expected = mid
                if sent.get("client_order_id"):
                    self.expected_px[sent["client_order_id"]] = expected
                self.reconcile_needed = True
                if o.purpose != "leg" and o.side == "buy":
                    self.resting_bid_usd += o.qty * (o.limit_price or mid)
                out.append(self._order_dict(o, "sent"))
            except MarketClosedError as exc:
                out.append(self._order_dict(o, "skipped", str(exc)))
            except AlpacaAPIError as exc:
                self.inv.orders_rejected += 1
                out.append(self._order_dict(o, "rejected", str(exc)[:200]))
        if requote:
            self.resting_kind = kind
        return out

    @staticmethod
    def _order_dict(o, status: str, error: str | None = None) -> dict:
        d = {"purpose": o.purpose, "side": o.side, "type": o.type, "qty": o.qty,
             "limit_price": o.limit_price, "status": status}
        if error:
            d["error"] = error
        return d

    async def _kill(self, now: float) -> str:
        self.resting_kind, self.resting_bid_usd = None, 0.0
        if self.dry:
            return f"shadow: would cancel own orders and flatten {self.inv.inventory:g}"
        return await flatten(self.market, self.cfg.spec, self.inv, self.fills_seen, self.expected_px,
                             self.session_start_iso, now, sleep=self._sleep)

    async def _emit(self, now: float, snapshot: dict | None, *, action: str, reason: str, rung: str, fill: str,
                    answers: dict | None = None, meta: dict | None = None, orders: list | None = None,
                    direction_leg: str | None = None) -> None:
        meta = meta or {}
        record = {
            "tick": self.tick_no,
            "ts": now,
            "mid": snapshot["mid"] if snapshot else None,
            "spread_bps": round(snapshot["spread_bps"], 3) if snapshot else None,
            "action": action,
            "action_reason": reason,
            "rung": rung,
            "direction_leg": direction_leg,
            "direction": answers["direction"]["choice"] if answers else None,
            "direction_conf": answers["direction"]["confidence"] if answers else None,
            "latency_ms": meta.get("latency_ms"),
            "route": self.route,
            "model": self.model,
            "inventory": self.inv.inventory,
            "unrealised_pnl_usd": snapshot["unrealised_pnl_usd"] if snapshot else None,
            "realised_pnl_usd": round(self.inv.realised_pnl_usd, 6),
            "drawdown_pct": snapshot["drawdown_pct"] if snapshot else None,
            "fill": fill,
            "orders": orders or [],
            "answers": answers,
            "snapshot": snapshot,
        }
        await self.sink.on_tick(record, self.summary(record["mid"]))
