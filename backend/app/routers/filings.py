"""SEC filings for a portfolio's holdings (roadmap 3.3): what changed in recent
10-K/10-Q risk factors and 8-K reports, with cited digests, plus Form 4 insider
activity. GET reads the store; it starts a background refresh from EDGAR when
the store has never seen the holdings or is older than a day. POST refresh asks
for one now. See services/edgar_service.py and filing_digest_service.py."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import Portfolio
from app.models.sec_filing import SecCik
from app.models.user import User
from app.services import edgar_service, filing_digest_service

router = APIRouter()

STALE_AFTER = timedelta(hours=24)
_tasks: set[asyncio.Task] = set()


async def _own(db: AsyncSession, portfolio_id: UUID, user: User) -> Portfolio:
    p = (await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


def _start_refresh(portfolio_id: UUID, tickers: list[str], *, force: bool) -> bool:
    key = str(portfolio_id)
    if key in filing_digest_service.running or not tickers:
        return False
    filing_digest_service.running.add(key)  # visible before the task first runs
    task = asyncio.create_task(filing_digest_service.refresh(tickers, force=force, key=key))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return True


@router.get("/portfolio/{portfolio_id}/filings")
async def get_filings(portfolio_id: UUID, days: int = Query(90, ge=7, le=120),
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _own(db, portfolio_id, user)
    tickers = await edgar_service.held_tickers(db, portfolio_id)
    out = await filing_digest_service.report(db, tickers, days=days)
    last = out["last_synced_at"]
    if out["covered"]:
        stale = last is None or datetime.now(timezone.utc) - datetime.fromisoformat(last) > STALE_AFTER
    else:
        # No holding files with the SEC (funds, crypto) — refresh only to load the ticker → CIK map.
        stale = bool(tickers) and (await db.execute(select(SecCik.ticker).limit(1))).first() is None
    if stale:
        _start_refresh(portfolio_id, tickers, force=False)
    out["syncing"] = str(portfolio_id) in filing_digest_service.running
    out["llm_available"] = await filing_digest_service._team_llm(db) is not None
    out["holdings"] = len(tickers)
    return out


@router.post("/portfolio/{portfolio_id}/filings/refresh", status_code=status.HTTP_202_ACCEPTED)
async def refresh_filings(portfolio_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _own(db, portfolio_id, user)
    tickers = await edgar_service.held_tickers(db, portfolio_id)
    if not tickers:
        raise HTTPException(status_code=422, detail="This portfolio has no holdings yet.")
    started = _start_refresh(portfolio_id, tickers, force=True)
    return {"started": started, "syncing": True}
