"""JEV Lab session lifecycle: background tasks, persistence, recovery, retention.

Mirrors job_manager: one asyncio.Task per running session, kept in-process
(single uvicorn worker, the same assumption job_manager makes).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.database import AsyncSessionLocal
from app.models.jev import JevSession, JevSessionStatus, JevTick
from app.services.alpaca_paper_client import AlpacaConfigError, alpaca_client_from_db
from app.services.jev_client import resolve_jev_client
from app.services.jev_loop_runner import JevLoop, LoopConfig, flatten, iso, reconcile_fills
from app.services.websocket_manager import ws_manager
from jev_loop.assets import resolve_symbol
from jev_loop.limits import validate_limit_overrides
from jev_loop.state import InventoryState
from jev_loop.strategy import validate_threshold_overrides

logger = logging.getLogger(__name__)

MAX_ACTIVE_SESSIONS = 2
TICK_RETENTION_DAYS = 14

_tasks: dict[str, asyncio.Task] = {}


def ws_key(session_id) -> str:
    return f"jev:{session_id}"


async def start_session(session_id: str) -> None:
    task = asyncio.create_task(execute_session(session_id))
    _tasks[session_id] = task
    task.add_done_callback(lambda _: _tasks.pop(session_id, None))


def stop_session(session_id: str) -> bool:
    task = _tasks.get(session_id)
    if task and not task.done():
        task.cancel()
        return True
    return False


def is_active(session_id: str) -> bool:
    return session_id in _tasks


class DbSink:
    """Persists each tick and the session's running totals, then broadcasts."""

    def __init__(self, session_id):
        self.session_id = uuid.UUID(str(session_id))

    @staticmethod
    def _apply_summary(s: JevSession, summary: dict) -> None:
        for field in ("tick_count", "inventory", "realised_pnl_usd", "fills", "orders_submitted",
                      "orders_rejected", "decision_route", "decision_model", "cost_usd", "start_equity_usd"):
            if field in summary:
                setattr(s, field, summary[field])
        if summary.get("last_mid") is not None:
            s.last_mid = summary["last_mid"]

    async def on_tick(self, record: dict, summary: dict) -> None:
        async with AsyncSessionLocal() as db:
            db.add(JevTick(
                session_id=self.session_id,
                tick=record["tick"],
                ts=datetime.fromtimestamp(record["ts"], tz=timezone.utc),
                **{k: record.get(k) for k in (
                    "mid", "spread_bps", "action", "action_reason", "rung", "direction_leg", "direction",
                    "direction_conf", "latency_ms", "route", "model", "inventory", "unrealised_pnl_usd",
                    "realised_pnl_usd", "drawdown_pct", "fill", "answers", "snapshot")},
                orders=record.get("orders") or [],
            ))
            s = await db.get(JevSession, self.session_id)
            if s is not None:
                self._apply_summary(s, summary)
            await db.commit()
        await ws_manager.broadcast(ws_key(self.session_id), {"type": "tick", "tick": record, "summary": summary})

    async def on_status(self, status: str, reason: str | None, summary: dict) -> None:
        async with AsyncSessionLocal() as db:
            s = await db.get(JevSession, self.session_id)
            if s is not None:
                self._apply_summary(s, summary)
                s.status = JevSessionStatus(status)
                s.stop_reason = reason
                s.stopped_at = datetime.now(timezone.utc)
            await db.commit()
        await ws_manager.broadcast(
            ws_key(self.session_id), {"type": "status", "status": status, "reason": reason, "summary": summary}
        )


async def execute_session(session_id: str) -> None:
    sink = DbSink(session_id)
    market = decider = None
    try:
        async with AsyncSessionLocal() as db:
            s = await db.get(JevSession, uuid.UUID(session_id))
            if s is None:
                return
            spec = resolve_symbol(s.symbol)
            limits = validate_limit_overrides(s.limits)
            cfg = LoopConfig(
                session_id=session_id,
                spec=spec,
                mode=s.mode,
                limits=limits,
                thresholds=validate_threshold_overrides(s.thresholds),
                max_ticks=s.max_ticks,
                max_duration_s=s.max_duration_s,
            )
            market = await alpaca_client_from_db(db, spec, s.order_prefix)
            decider = await resolve_jev_client(db, force_mock=s.force_mock, max_position_usd=limits.max_position_usd)
        await JevLoop(cfg, market, decider, sink).run()
    except AlpacaConfigError as exc:
        await sink.on_status("failed", str(exc), {})
    finally:
        for client in (market, decider):
            if client is not None:
                await client.aclose()


async def flatten_session(session: JevSession) -> str:
    """Close what a finished paper session left open. Inventory is rebuilt
    from the broker's own record of this session's fills."""
    spec = resolve_symbol(session.symbol)
    async with AsyncSessionLocal() as db:
        market = await alpaca_client_from_db(db, spec, session.order_prefix, id_namespace=f"f{uuid.uuid4().hex[:4]}-")
    try:
        inv = InventoryState()
        seen: dict = {}
        started = (session.started_at or session.created_at).timestamp() - 5
        now = datetime.now(timezone.utc).timestamp()
        await reconcile_fills(market, inv, seen, {}, iso(started), now)
        msg = await flatten(market, spec, inv, seen, {}, iso(started), now)
    finally:
        await market.aclose()
    async with AsyncSessionLocal() as db:
        row = await db.get(JevSession, session.id)
        row.inventory = inv.inventory
        await db.commit()
    return msg


async def recover_interrupted_sessions() -> None:
    """On boot nothing is running yet: any 'running' row was cut off by a
    restart. Mark it interrupted and, for paper sessions, cancel its resting
    orders. Positions are left for a human to flatten from the UI. Never
    raises: JEV Lab must not be able to stop the rest of the app booting."""
    try:
        await _recover_interrupted_sessions()
    except Exception:  # noqa: BLE001
        logger.exception("jev session recovery skipped")


async def _recover_interrupted_sessions() -> None:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(JevSession).where(JevSession.status == JevSessionStatus.running))).scalars().all()
        for s in rows:
            s.status = JevSessionStatus.interrupted
            s.stop_reason = "interrupted by a backend restart"
            s.stopped_at = datetime.now(timezone.utc)
        await db.commit()
        for s in rows:
            if s.mode != "paper":
                continue
            try:
                market = await alpaca_client_from_db(db, resolve_symbol(s.symbol), s.order_prefix)
                try:
                    await market.cancel_own_orders()
                finally:
                    await market.aclose()
            except Exception:  # noqa: BLE001 - startup must never fail on this
                logger.warning("could not cancel orders for interrupted jev session %s", s.id)


async def prune_old_ticks(days: int = TICK_RETENTION_DAYS) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    async with AsyncSessionLocal() as db:
        result = await db.execute(delete(JevTick).where(JevTick.ts < cutoff))
        await db.commit()
        return result.rowcount or 0
