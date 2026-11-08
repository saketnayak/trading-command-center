"""GET /portfolio/{id}/performance (logic in services/portfolio_performance_service.py)."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, resolve_display_currency
from app.models.portfolio import Portfolio
from app.models.user import User
from app.services.portfolio_performance_service import BENCHMARK_RE, RangeKey, build_performance_report

router = APIRouter()


@router.get("/portfolio/{portfolio_id}/performance")
async def portfolio_performance(
    portfolio_id: UUID,
    mode: Literal["auto", "actual", "current"] = Query("auto"),
    range_key: RangeKey = Query("1y", alias="range"),
    benchmark: str = Query("SPY", min_length=1, max_length=16),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    display_currency: str = Depends(resolve_display_currency),
):
    benchmark = benchmark.strip().upper()
    if not BENCHMARK_RE.match(benchmark):
        raise HTTPException(status_code=422, detail=f"'{benchmark}' is not a valid benchmark ticker")
    portfolio = (
        await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    ).scalar_one_or_none()
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return await build_performance_report(
        db, portfolio_id, display_currency=display_currency,
        mode=mode, range_key=range_key, benchmark=benchmark,
    )
