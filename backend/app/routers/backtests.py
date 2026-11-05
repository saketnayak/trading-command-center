"""Agent Backtest Lab: replay the TradingAgents pipeline on past dates.

GET    /backtests/meta          limits, analysts and the known model training cutoffs
POST   /backtests               create and queue (one runs at a time per server)
GET    /backtests               the caller's backtests (summary, no per-decision rows)
GET    /backtests/{id}          one backtest with its decisions and report
POST   /backtests/{id}/abort    stop after the decision in flight
DELETE /backtests/{id}          delete a finished backtest

Research only: a backtest scores recommendations against later prices; it
never places an order.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.backtest import Backtest
from app.models.user import User
from app.services import backtest_runner
from app.services.alert_rules import TICKER_RE
from app.services.backtest_calc import MODEL_CUTOFFS, cutoff_for, decision_grid
from app.utils.tradingagents_analysts import normalize_analysts

router = APIRouter()

MAX_TICKERS = 5
MAX_DECISIONS = 120  # real runs: each decision is a full multi-agent analysis
MAX_DECISIONS_DRY = 300
MAX_BUDGET_USD = 200.0
MAX_ACTIVE_PER_USER = 3
KEYED_PROVIDERS = ("openai", "anthropic", "google", "groq", "ionos")
ANALYSTS = ("market", "social", "news", "fundamentals")


class BacktestIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    tickers: list[str] = Field(min_length=1, max_length=MAX_TICKERS)
    start_date: date
    end_date: date
    frequency: Literal["weekly", "daily"] = "weekly"
    horizon_days: int = Field(default=5, ge=1, le=30)
    llm_provider: str = Field(default="openai", max_length=32)
    llm_model: str = Field(default="gpt-4o-mini", max_length=100)
    depth: Literal["quick", "standard", "deep"] = "quick"
    analysts: list[str] = Field(default_factory=lambda: ["market", "news"])
    budget_usd: float | None = Field(default=None, gt=0, le=MAX_BUDGET_USD)
    dry_run: bool = True
    reflect: bool = True
    training_cutoff: date | None = None


def _summary(bt: Backtest) -> dict:
    headline = (bt.report or {}).get("headline") or {}
    return {
        "id": str(bt.id), "name": bt.name, "status": bt.status, "config": bt.config,
        "total_decisions": bt.total_decisions, "done": len(bt.trades or []), "cost_usd": round(bt.cost_usd or 0.0, 4),
        "error": bt.error, "created_at": bt.created_at.isoformat() if bt.created_at else None,
        "started_at": bt.started_at.isoformat() if bt.started_at else None,
        "completed_at": bt.completed_at.isoformat() if bt.completed_at else None,
        "headline_basis": (bt.report or {}).get("headline_basis"),
        "headline": {k: headline.get(k) for k in ("total_return", "hit_rate", "sharpe", "excess_vs_buy_and_hold")} if headline else None,
    }


async def _own(db: AsyncSession, backtest_id: UUID, user: User) -> Backtest:
    bt = (await db.execute(select(Backtest).where(Backtest.id == backtest_id, Backtest.user_id == user.id))).scalar_one_or_none()
    if bt is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    return bt


@router.get("/backtests/meta")
async def backtest_meta(_user: User = Depends(get_current_user)):
    return {
        "limits": {"tickers": MAX_TICKERS, "decisions": MAX_DECISIONS, "decisions_dry_run": MAX_DECISIONS_DRY,
                   "budget_usd": MAX_BUDGET_USD, "horizon_days": [1, 30]},
        "analysts": list(ANALYSTS),
        "model_cutoffs": MODEL_CUTOFFS,
    }


@router.post("/backtests", status_code=status.HTTP_201_CREATED)
async def create_backtest(body: BacktestIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tickers = []
    for t in body.tickers:
        sym = t.strip().upper()
        if not TICKER_RE.match(sym):
            raise HTTPException(status_code=422, detail=f"Invalid ticker: {t!r}")
        if sym not in tickers:
            tickers.append(sym)
    today = datetime.now(timezone.utc).date()
    latest_end = today - timedelta(days=body.horizon_days * 7 // 5 + 3)
    if body.start_date > body.end_date:
        raise HTTPException(status_code=422, detail="The start date must be on or before the end date.")
    if body.start_date < date(2000, 1, 1):
        raise HTTPException(status_code=422, detail="Start in 2000 or later.")
    if body.end_date > latest_end:
        raise HTTPException(status_code=422, detail=f"End by {latest_end.isoformat()} so every decision has {body.horizon_days} trading days of prices after it.")
    dates = decision_grid(body.start_date, body.end_date, body.frequency)
    total = len(dates) * len(tickers)
    cap = MAX_DECISIONS_DRY if body.dry_run else MAX_DECISIONS
    if total == 0:
        raise HTTPException(status_code=422, detail="No trading days in that range.")
    if total > cap:
        raise HTTPException(status_code=422, detail=f"That is {total} decisions (tickers × dates); the limit is {cap}. Shorten the range, use weekly, or drop tickers.")
    analysts = [a for a in normalize_analysts(body.analysts) if a in ANALYSTS]
    if not analysts:
        raise HTTPException(status_code=422, detail=f"Pick at least one analyst: {', '.join(ANALYSTS)}.")
    if not body.dry_run:
        if body.budget_usd is None:
            raise HTTPException(status_code=422, detail="Set a budget cap in USD for a real backtest.")
        if body.llm_provider in KEYED_PROVIDERS:
            from app.services.trading_agent_runner import _get_stored_key
            if not await _get_stored_key(body.llm_provider):
                raise HTTPException(status_code=422, detail=f"Add a {body.llm_provider} API key in Settings first, or use a dry run.")
    active = (await db.execute(select(func.count()).select_from(Backtest).where(
        Backtest.user_id == user.id, Backtest.status.in_(("pending", "running"))))).scalar_one()
    if active >= MAX_ACTIVE_PER_USER:
        raise HTTPException(status_code=409, detail=f"You already have {active} backtests queued or running.")

    cutoff = body.training_cutoff.isoformat() if body.training_cutoff else cutoff_for(body.llm_model)
    config = {
        "tickers": tickers, "start_date": body.start_date.isoformat(), "end_date": body.end_date.isoformat(),
        "frequency": body.frequency, "horizon_days": body.horizon_days, "llm_provider": body.llm_provider,
        "llm_model": body.llm_model, "depth": body.depth, "analysts": analysts,
        "budget_usd": body.budget_usd, "dry_run": body.dry_run, "reflect": body.reflect and not body.dry_run,
        "training_cutoff": cutoff, "cutoff_source": "you" if body.training_cutoff else ("table" if cutoff else None),
        "total_decisions": total,
    }
    name = (body.name or "").strip() or f"{', '.join(tickers)} · {body.start_date:%b %Y}–{body.end_date:%b %Y}" + (" (dry run)" if body.dry_run else "")
    bt = Backtest(user_id=user.id, name=name[:120], status="pending", config=config, total_decisions=total, trades=[])
    db.add(bt)
    await db.commit()
    await db.refresh(bt)
    backtest_runner.start_backtest(str(bt.id))
    return _summary(bt)


@router.get("/backtests")
async def list_backtests(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(Backtest).where(Backtest.user_id == user.id).order_by(Backtest.created_at.desc()).limit(100))).scalars().all()
    return [_summary(bt) for bt in rows]


@router.get("/backtests/{backtest_id}")
async def get_backtest(backtest_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bt = await _own(db, backtest_id, user)
    return {**_summary(bt), "trades": bt.trades or [], "report": bt.report}


@router.post("/backtests/{backtest_id}/abort", status_code=status.HTTP_202_ACCEPTED)
async def abort_backtest(backtest_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bt = await _own(db, backtest_id, user)
    if not backtest_runner.request_abort(str(bt.id)):
        raise HTTPException(status_code=409, detail="This backtest isn't running.")
    return {"status": "stopping"}


@router.delete("/backtests/{backtest_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_backtest(backtest_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bt = await _own(db, backtest_id, user)
    if backtest_runner.is_active(str(bt.id)):
        raise HTTPException(status_code=409, detail="Stop the backtest before deleting it.")
    await db.delete(bt)
    await db.commit()
