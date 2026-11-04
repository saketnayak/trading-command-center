"""Alerts: rule CRUD, a dry-run "check now", and the in-app inbox.

Rules are per user. Ticker rules may name a portfolio, whose delivery
settings the webhook channel then uses; portfolio rules must name one.
Evaluation happens in the scheduler (services/alert_engine.py).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.alert import AlertEvent, AlertRule
from app.models.portfolio import Portfolio
from app.models.user import User
from app.services import alert_engine
from app.services.alert_rules import KINDS, TICKER_RE, RuleParamError, validate_params

router = APIRouter()

MAX_RULES_PER_USER = 100
Channel = Literal["inbox", "email", "webhook"]


class RuleCreate(BaseModel):
    kind: str
    ticker: str | None = None
    portfolio_id: UUID | None = None
    params: dict = Field(default_factory=dict)
    channels: list[Channel] = Field(default_factory=lambda: ["inbox"])
    cooldown_hours: int = Field(default=6, ge=0, le=168)
    enabled: bool = True


class RuleUpdate(BaseModel):
    params: dict | None = None
    channels: list[Channel] | None = None
    cooldown_hours: int | None = Field(default=None, ge=0, le=168)
    enabled: bool | None = None


class MarkRead(BaseModel):
    ids: list[UUID] | None = None
    all: bool = False


def _rule_dict(r: AlertRule, portfolio_name: str | None = None) -> dict:
    return {
        "id": str(r.id),
        "kind": r.kind,
        "kind_label": KINDS[r.kind].label if r.kind in KINDS else r.kind,
        "ticker": r.ticker,
        "portfolio_id": str(r.portfolio_id) if r.portfolio_id else None,
        "portfolio_name": portfolio_name,
        "params": r.params,
        "channels": r.channels,
        "cooldown_hours": r.cooldown_hours,
        "enabled": r.enabled,
        "state": r.state,
        "last_checked_at": r.last_checked_at.isoformat() if r.last_checked_at else None,
        "last_triggered_at": r.last_triggered_at.isoformat() if r.last_triggered_at else None,
        "last_error": r.last_error,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _event_dict(e: AlertEvent) -> dict:
    return {
        "id": str(e.id),
        "rule_id": str(e.rule_id) if e.rule_id else None,
        "kind": e.kind,
        "ticker": e.ticker,
        "portfolio_id": str(e.portfolio_id) if e.portfolio_id else None,
        "title": e.title,
        "message": e.message,
        "data": e.data,
        "delivery": e.delivery,
        "triggered_at": e.triggered_at.isoformat() if e.triggered_at else None,
        "read_at": e.read_at.isoformat() if e.read_at else None,
    }


async def _own_portfolio(db: AsyncSession, portfolio_id: UUID, user: User) -> Portfolio:
    p = (await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


async def _own_rule(db: AsyncSession, rule_id: UUID, user: User) -> AlertRule:
    r = (await db.execute(select(AlertRule).where(AlertRule.id == rule_id, AlertRule.user_id == user.id))).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    return r


def _channels(channels: list[str], portfolio_id) -> list[str]:
    out = ["inbox"] + sorted({c for c in channels if c != "inbox"})
    if "webhook" in out and portfolio_id is None:
        raise HTTPException(status_code=422, detail="Webhook delivery uses a portfolio's delivery settings; choose a portfolio.")
    return out


@router.get("/alerts/rules")
async def list_rules(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        await db.execute(
            select(AlertRule, Portfolio.name)
            .outerjoin(Portfolio, Portfolio.id == AlertRule.portfolio_id)
            .where(AlertRule.user_id == user.id)
            .order_by(AlertRule.created_at.desc())
        )
    ).all()
    return [_rule_dict(r, name) for r, name in rows]


@router.post("/alerts/rules", status_code=status.HTTP_201_CREATED)
async def create_rule(body: RuleCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        params = validate_params(body.kind, body.params)
    except RuleParamError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    spec = KINDS[body.kind]
    ticker = body.ticker.strip().upper() if body.ticker else None
    if spec.scope == "ticker":
        if not ticker or not TICKER_RE.match(ticker):
            raise HTTPException(status_code=422, detail="This alert needs a valid ticker")
    else:
        ticker = None
        if body.portfolio_id is None:
            raise HTTPException(status_code=422, detail="This alert needs a portfolio")
    portfolio = await _own_portfolio(db, body.portfolio_id, user) if body.portfolio_id else None
    count = (await db.execute(select(func.count()).select_from(AlertRule).where(AlertRule.user_id == user.id))).scalar_one()
    if count >= MAX_RULES_PER_USER:
        raise HTTPException(status_code=409, detail=f"At most {MAX_RULES_PER_USER} alert rules per user")
    rule = AlertRule(
        user_id=user.id, portfolio_id=body.portfolio_id, ticker=ticker, kind=body.kind, params=params,
        channels=_channels(body.channels, body.portfolio_id), cooldown_hours=body.cooldown_hours,
        enabled=body.enabled, state=None,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _rule_dict(rule, portfolio.name if portfolio else None)


@router.patch("/alerts/rules/{rule_id}")
async def update_rule(rule_id: UUID, body: RuleUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rule = await _own_rule(db, rule_id, user)
    if body.params is not None:
        try:
            rule.params = validate_params(rule.kind, body.params)
        except RuleParamError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        rule.state = None  # a new threshold starts a fresh edge/baseline
    if body.channels is not None:
        rule.channels = _channels(body.channels, rule.portfolio_id)
    if body.cooldown_hours is not None:
        rule.cooldown_hours = body.cooldown_hours
    if body.enabled is not None:
        rule.enabled = body.enabled
    await db.commit()
    await db.refresh(rule)
    return _rule_dict(rule)


@router.delete("/alerts/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rule = await _own_rule(db, rule_id, user)
    await db.delete(rule)
    await db.commit()


@router.post("/alerts/rules/{rule_id}/check")
async def check_rule(rule_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Evaluate against live data now. Read-only: no state change, nothing fires."""
    rule = await _own_rule(db, rule_id, user)
    ev = await alert_engine.check_rule(db, rule)
    family = KINDS[rule.kind].family
    return {
        "condition": ev.condition,
        "observed": ev.observed,
        "would_fire": ev.fire,
        "note": (
            "Fires when this becomes true, then re-arms once it is false again."
            if family == "level" else
            "Fires when this value changes from the one recorded at the last check."
        ),
    }


@router.get("/alerts/events")
async def list_events(
    limit: int = Query(50, ge=1, le=200),
    unread_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(AlertEvent).where(AlertEvent.user_id == user.id)
    if unread_only:
        q = q.where(AlertEvent.read_at.is_(None))
    rows = (await db.execute(q.order_by(AlertEvent.triggered_at.desc()).limit(limit))).scalars().all()
    return [_event_dict(e) for e in rows]


@router.get("/alerts/unread-count")
async def unread_count(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    n = (await db.execute(select(func.count()).select_from(AlertEvent).where(
        AlertEvent.user_id == user.id, AlertEvent.read_at.is_(None)))).scalar_one()
    return {"unread": n}


@router.post("/alerts/events/read")
async def mark_read(body: MarkRead, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if not body.all and not body.ids:
        raise HTTPException(status_code=422, detail="Pass ids or all=true")
    q = update(AlertEvent).where(AlertEvent.user_id == user.id, AlertEvent.read_at.is_(None))
    if not body.all:
        q = q.where(AlertEvent.id.in_(body.ids))
    result = await db.execute(q.values(read_at=datetime.now(timezone.utc)))
    await db.commit()
    return {"marked": result.rowcount or 0}
