"""JEV Lab: Jev-driven market-making sessions. Shadow by default; paper is
admin-only; there is no live-trading path. Everything 404s while the
enable_jev_loop setting is off."""
from __future__ import annotations

import uuid
from dataclasses import asdict, fields
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.dependencies import get_current_user
from app.models.api_key import ApiKey
from app.models.jev import JevSession, JevSessionStatus, JevTick
from app.models.user import User, UserRole
from app.services.alpaca_paper_client import AlpacaAPIError, AlpacaConfigError, MarketClosedError, new_order_prefix
from app.services.auth import decode_access_token
from app.services.jev_session_manager import (
    MAX_ACTIVE_SESSIONS,
    flatten_session,
    is_active,
    start_session,
    stop_session,
    ws_key,
)
from app.services.settings_service import get_app_settings
from app.services.websocket_manager import ws_manager
from jev_loop.assets import UnknownSymbolError, resolve_symbol
from jev_loop.calibrate import calibration_report
from jev_loop.limits import LOWERABLE_LIMITS, Limits, LimitOverrideError, validate_limit_overrides
from jev_loop.split import split_rows
from jev_loop.strategy import StrategyThresholds, ThresholdOverrideError, validate_threshold_overrides

router = APIRouter()


async def require_jev_enabled(db: AsyncSession = Depends(get_db)) -> None:
    settings = await get_app_settings(db)
    if not settings["enable_jev_loop"]:
        raise HTTPException(status_code=404, detail="JEV Lab is disabled")


class SessionCreate(BaseModel):
    symbol: str
    mode: Literal["shadow", "paper"] = "shadow"
    max_ticks: int | None = Field(default=None, ge=1, le=100_000)
    max_duration_minutes: int = Field(default=60, ge=1, le=1440)
    thresholds: dict[str, float] = Field(default_factory=dict)
    limits: dict[str, float] = Field(default_factory=dict)
    force_mock: bool = False


def _session_dict(s: JevSession) -> dict:
    return {
        "id": str(s.id),
        "created_by": str(s.created_by),
        "symbol": s.symbol,
        "mode": s.mode,
        "status": s.status.value,
        "force_mock": s.force_mock,
        "thresholds": s.thresholds or {},
        "limits": s.limits or {},
        "max_ticks": s.max_ticks,
        "max_duration_s": s.max_duration_s,
        "order_prefix": s.order_prefix,
        "decision_route": s.decision_route,
        "decision_model": s.decision_model,
        "start_equity_usd": s.start_equity_usd,
        "tick_count": s.tick_count,
        "inventory": s.inventory,
        "realised_pnl_usd": s.realised_pnl_usd,
        "last_mid": s.last_mid,
        "fills": s.fills,
        "orders_submitted": s.orders_submitted,
        "orders_rejected": s.orders_rejected,
        "cost_usd": s.cost_usd,
        "stop_reason": s.stop_reason,
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "stopped_at": s.stopped_at.isoformat() if s.stopped_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _tick_dict(t: JevTick, full: bool = True) -> dict:
    d = {
        "tick": t.tick,
        "ts": t.ts.timestamp(),
        "mid": t.mid,
        "spread_bps": t.spread_bps,
        "action": t.action,
        "action_reason": t.action_reason,
        "rung": t.rung,
        "direction_leg": t.direction_leg,
        "direction": t.direction,
        "direction_conf": t.direction_conf,
        "latency_ms": t.latency_ms,
        "route": t.route,
        "model": t.model,
        "inventory": t.inventory,
        "unrealised_pnl_usd": t.unrealised_pnl_usd,
        "realised_pnl_usd": t.realised_pnl_usd,
        "drawdown_pct": t.drawdown_pct,
        "fill": t.fill,
        "orders": t.orders or [],
    }
    if full:
        d["answers"] = t.answers
        d["snapshot"] = t.snapshot
    return d


async def _has_valid_key(db: AsyncSession, *providers: str) -> bool:
    row = (
        await db.execute(select(ApiKey.id).where(ApiKey.provider.in_(providers), ApiKey.is_valid.is_(True)))
    ).first()
    return row is not None


async def _get_session(db: AsyncSession, session_id: UUID) -> JevSession:
    s = await db.get(JevSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return s


def _require_owner_or_admin(s: JevSession, user: User) -> None:
    if user.role != UserRole.admin and s.created_by != user.id:
        raise HTTPException(status_code=403, detail="Only the session owner or an admin can do this")


@router.get("/jev/meta", dependencies=[Depends(require_jev_enabled)])
async def jev_meta(user: User = Depends(get_current_user)):
    return {
        "split": split_rows(),
        "limits": asdict(Limits()),
        "lowerable_limits": sorted(LOWERABLE_LIMITS | {"tick_seconds"}),
        "thresholds": asdict(StrategyThresholds()),
        "threshold_names": [f.name for f in fields(StrategyThresholds)],
        "max_active_sessions": MAX_ACTIVE_SESSIONS,
    }


@router.get("/jev/symbols/validate", dependencies=[Depends(require_jev_enabled)])
async def validate_symbol(symbol: str = Query(...), user: User = Depends(get_current_user)):
    try:
        spec = resolve_symbol(symbol)
    except UnknownSymbolError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "symbol": spec.symbol,
        "asset_class": spec.asset_class,
        "is_24_7": spec.is_24_7,
        "has_depth": spec.has_depth,
        "min_notional_usd": spec.min_notional_usd,
        "qty_precision": spec.qty_precision,
    }


@router.post("/jev/sessions", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_jev_enabled)])
async def create_session(body: SessionCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        spec = resolve_symbol(body.symbol)
        validate_limit_overrides(body.limits)
        validate_threshold_overrides(body.thresholds)
    except (UnknownSymbolError, LimitOverrideError, ThresholdOverrideError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if body.mode == "paper":
        if user.role != UserRole.admin:
            raise HTTPException(status_code=403, detail="Paper trading sessions are admin-only")
        if body.force_mock:
            raise HTTPException(status_code=400, detail="Paper mode needs a real Jev decision; the mock is shadow-only")
    if not await _has_valid_key(db, "alpaca_paper"):
        raise HTTPException(status_code=400, detail="Add a valid Alpaca paper key under Settings → JEV Lab first")
    if body.mode == "paper" and not await _has_valid_key(db, "typesafe", "ai_gateway"):
        raise HTTPException(status_code=400, detail="Paper mode needs a Jev key (Vercel AI Gateway or TypeSafe)")

    running = select(func.count()).select_from(JevSession).where(JevSession.status == JevSessionStatus.running)
    if (await db.execute(running)).scalar_one() >= MAX_ACTIVE_SESSIONS:
        raise HTTPException(status_code=409, detail=f"At most {MAX_ACTIVE_SESSIONS} sessions can run at once")
    if body.mode == "paper":
        same = running.where(JevSession.mode == "paper", JevSession.symbol == spec.symbol)
        if (await db.execute(same)).scalar_one():
            raise HTTPException(status_code=409, detail=f"A paper session on {spec.symbol} is already running")

    s = JevSession(
        id=uuid.uuid4(),
        created_by=user.id,
        symbol=spec.symbol,
        mode=body.mode,
        status=JevSessionStatus.running,
        force_mock=body.force_mock,
        thresholds=body.thresholds,
        limits=body.limits,
        max_ticks=body.max_ticks,
        max_duration_s=body.max_duration_minutes * 60,
        order_prefix=new_order_prefix(),
        started_at=datetime.now(timezone.utc),
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    await start_session(str(s.id))
    return _session_dict(s)


@router.get("/jev/sessions", dependencies=[Depends(require_jev_enabled)])
async def list_sessions(
    limit: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = (await db.execute(select(JevSession).order_by(JevSession.created_at.desc()).limit(limit))).scalars().all()
    return [_session_dict(s) for s in rows]


@router.get("/jev/sessions/{session_id}", dependencies=[Depends(require_jev_enabled)])
async def get_session(session_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return _session_dict(await _get_session(db, session_id))


@router.get("/jev/sessions/{session_id}/ticks", dependencies=[Depends(require_jev_enabled)])
async def list_ticks(
    session_id: UUID,
    after: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    full: bool = Query(False),
    tail: int | None = Query(None, ge=1, le=2000, description="Return the latest N ticks instead of paging forward"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_session(db, session_id)
    query = select(JevTick).where(JevTick.session_id == session_id)
    if tail is not None:
        rows = (await db.execute(query.order_by(JevTick.tick.desc()).limit(tail))).scalars().all()[::-1]
    else:
        rows = (
            await db.execute(query.where(JevTick.tick > after).order_by(JevTick.tick).limit(limit))
        ).scalars().all()
    return [_tick_dict(t, full=full) for t in rows]


@router.get("/jev/sessions/{session_id}/calibration", dependencies=[Depends(require_jev_enabled)])
async def session_calibration(
    session_id: UUID,
    horizon: int = Query(5, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_session(db, session_id)
    rows = (
        await db.execute(
            select(JevTick.mid, JevTick.direction, JevTick.direction_conf)
            .where(JevTick.session_id == session_id)
            .order_by(JevTick.tick)
        )
    ).all()
    ticks = [{"mid": m, "direction": d, "direction_conf": c} for m, d, c in rows]
    return calibration_report(ticks, horizon=horizon)


@router.post("/jev/sessions/{session_id}/stop", dependencies=[Depends(require_jev_enabled)])
async def stop(session_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    s = await _get_session(db, session_id)
    _require_owner_or_admin(s, user)
    if stop_session(str(session_id)):
        # The task pulls this session's quotes and writes the final status itself.
        return {**_session_dict(s), "status": "stopping"}
    if s.status == JevSessionStatus.running:  # no task behind it (orphaned row)
        s.status = JevSessionStatus.stopped
        s.stop_reason = "stopped by user"
        s.stopped_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(s)
    return _session_dict(s)


@router.post("/jev/sessions/{session_id}/flatten", dependencies=[Depends(require_jev_enabled)])
async def flatten(session_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    s = await _get_session(db, session_id)
    if user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Flattening a paper position is admin-only")
    if s.status == JevSessionStatus.running or is_active(str(session_id)):
        raise HTTPException(status_code=409, detail="Stop the session before flattening it")
    if s.mode != "paper":
        raise HTTPException(status_code=400, detail="Shadow sessions never hold a position")
    try:
        message = await flatten_session(s)
    except (AlpacaConfigError, AlpacaAPIError, MarketClosedError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    await db.refresh(s)
    return {"message": message, "session": _session_dict(s)}


@router.websocket("/ws/jev/{session_id}")
async def jev_websocket(session_id: str, ws: WebSocket, token: str = Query(...)):
    try:
        payload = decode_access_token(token)
        parsed = UUID(session_id)
    except Exception:
        await ws.close(code=4001)
        return
    async with AsyncSessionLocal() as db:
        user = await db.get(User, UUID(payload["sub"]))
        s = await db.get(JevSession, parsed)
        enabled = (await get_app_settings(db))["enable_jev_loop"]
        if not user or not s or not enabled:
            await ws.close(code=4004)
            return
    key = ws_key(session_id)
    await ws_manager.connect(key, ws)
    try:
        while True:
            await ws.receive_text()  # keep alive; the client pings
    except WebSocketDisconnect:
        ws_manager.disconnect(key, ws)
