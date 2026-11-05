"""ETF look-through for a portfolio (roadmap 3.4). GET reads stored fund data and starts a background
lookup for any holding that needs one; POST refresh asks for all of them now. See
services/fund_lookthrough_service.py and lookthrough_calc.py."""

from __future__ import annotations

import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import Portfolio
from app.models.user import User
from app.services import edgar_service, fund_lookthrough_service as service

router = APIRouter()

_tasks: set[asyncio.Task] = set()


async def _own(db: AsyncSession, portfolio_id: UUID, user: User) -> Portfolio:
    p = (await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


def _start_refresh(portfolio_id: UUID, tickers: list[str], *, force: bool) -> bool:
    key = str(portfolio_id)
    if key in service.running or not tickers:
        return False
    service.running.add(key)  # visible before the task first runs
    task = asyncio.create_task(service.refresh(tickers, force=force, key=key))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return True


@router.get("/portfolio/{portfolio_id}/xray")
async def get_xray(portfolio_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _own(db, portfolio_id, user)
    tickers = await edgar_service.held_tickers(db, portfolio_id)
    if await service.stale_tickers(db, tickers):
        _start_refresh(portfolio_id, tickers, force=False)
    out = await service.build_report(db, portfolio_id, display_currency=(user.preferred_currency or "USD").upper())
    out["syncing"] = str(portfolio_id) in service.running
    out["full_holdings_available"] = edgar_service.contact_configured()
    return out


@router.post("/portfolio/{portfolio_id}/xray/refresh", status_code=status.HTTP_202_ACCEPTED)
async def refresh_xray(portfolio_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _own(db, portfolio_id, user)
    tickers = await edgar_service.held_tickers(db, portfolio_id)
    if not tickers:
        raise HTTPException(status_code=422, detail="This portfolio has no holdings yet.")
    return {"started": _start_refresh(portfolio_id, tickers, force=True), "syncing": True}
