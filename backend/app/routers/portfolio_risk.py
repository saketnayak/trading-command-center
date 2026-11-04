"""GET /portfolio/{id}/risk (logic in services/portfolio_risk_service.py)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import Portfolio
from app.models.user import User
from app.services.portfolio_performance_service import BENCHMARK_RE
from app.services.portfolio_risk_service import LookbackKey, build_risk_report

router = APIRouter()


@router.get("/portfolio/{portfolio_id}/risk")
async def portfolio_risk(
    portfolio_id: UUID,
    lookback: LookbackKey = Query("1y"),
    benchmark: str = Query("SPY", min_length=1, max_length=16),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    benchmark = benchmark.strip().upper()
    if not BENCHMARK_RE.match(benchmark):
        raise HTTPException(status_code=422, detail=f"'{benchmark}' is not a valid benchmark ticker")
    portfolio = (
        await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    ).scalar_one_or_none()
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return await build_risk_report(
        db, portfolio_id, display_currency=(user.preferred_currency or "USD").upper(),
        lookback=lookback, benchmark=benchmark,
    )
