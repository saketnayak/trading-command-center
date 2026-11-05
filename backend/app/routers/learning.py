"""Learning loop settings and status (see services/learning_service.py).

GET    /learning            the caller's setting, memory counts and recent reflections
PUT    /learning            turn it on or off, choose the horizon (7 or 30 days)
POST   /learning/run        reflect now on due runs (up to 10), in the background
DELETE /learning/memories   forget everything the agents learned for this user
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.run import Run
from app.models.run_reflection import RunReflection
from app.models.user import User
from app.services import learning_service

router = APIRouter()
_running: dict[str, asyncio.Task] = {}


class LearningIn(BaseModel):
    enabled: bool
    horizon_days: int = 30


async def _status(db: AsyncSession, user: User) -> dict:
    today = datetime.now(timezone.utc).date()
    rows = (await db.execute(
        select(RunReflection, Run.ticker, Run.analysis_date, Run.verdict, Run.llm_model)
        .join(Run, Run.id == RunReflection.run_id).where(RunReflection.user_id == user.id)
        .order_by(RunReflection.created_at.desc()).limit(15))).all()
    by_status = dict((await db.execute(select(RunReflection.status, func.count()).where(
        RunReflection.user_id == user.id).group_by(RunReflection.status))).all())
    due = len(await learning_service.due_runs(db, user, today, limit=500)) if user.learning_enabled else None
    return {
        "enabled": user.learning_enabled,
        "horizon_days": user.learning_horizon_days,
        "horizons": list(learning_service.HORIZONS),
        "memories": learning_service.memory_counts(user.id),
        "reflections": {s: by_status.get(s, 0) for s in ("done", "failed", "skipped")},
        "due": due,
        "running": str(user.id) in _running,
        "recent": [{
            "run_id": str(r.run_id), "ticker": ticker, "analysis_date": d.isoformat(), "verdict": v.value if v else None,
            "model": model, "status": r.status, "horizon_days": r.horizon_days, "realised_return": r.realised_return,
            "stock_return": r.benchmark_return, "error": r.error, "attempts": r.attempts, "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r, ticker, d, v, model in rows],
        "per_pass": learning_service.MAX_PER_PASS,
    }


@router.get("/learning")
async def get_learning(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await _status(db, user)


@router.put("/learning")
async def put_learning(body: LearningIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if body.horizon_days not in learning_service.HORIZONS:
        raise HTTPException(status_code=422, detail="The horizon must be 7 or 30 days.")
    user.learning_enabled = body.enabled
    user.learning_horizon_days = body.horizon_days
    await db.commit()
    return await _status(db, user)


@router.post("/learning/run", status_code=status.HTTP_202_ACCEPTED)
async def run_learning(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if not user.learning_enabled:
        raise HTTPException(status_code=409, detail="Turn the learning loop on first.")
    key = str(user.id)
    if key in _running:
        raise HTTPException(status_code=409, detail="A reflection pass is already running.")
    task = asyncio.create_task(learning_service.reflect_for_user(user.id))
    _running[key] = task
    task.add_done_callback(lambda _: _running.pop(key, None))
    return {"status": "started"}


@router.delete("/learning/memories", status_code=status.HTTP_204_NO_CONTENT)
async def clear_memories(user: User = Depends(get_current_user)):
    if str(user.id) in _running:
        raise HTTPException(status_code=409, detail="Wait for the reflection pass to finish.")
    learning_service.clear_memories(user.id)
