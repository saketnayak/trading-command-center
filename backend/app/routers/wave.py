"""Elliott Wave + Fibonacci analysis endpoints."""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.user import User
from app.services.settings_service import get_app_settings
from app.services.wave_service import (
    DEFAULT_INTERVAL,
    DEFAULT_PERIOD,
    analyze_wave,
    get_wave_summary,
    get_wave_summaries_for_portfolio,
)

router = APIRouter()

VALID_PERIODS = Literal["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]
VALID_INTERVALS = Literal["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"]
VALID_PROFILES = Literal["full_confluence", "elliott_focused", "fib_only", "swing_only"]


class WaveAnalyzeRequest(BaseModel):
    period: VALID_PERIODS = DEFAULT_PERIOD
    interval: VALID_INTERVALS = DEFAULT_INTERVAL
    profile: VALID_PROFILES = "full_confluence"


@router.get("/wave/{ticker}")
async def get_ticker_wave_summary(
    ticker: str,
    period: VALID_PERIODS = DEFAULT_PERIOD,
    interval: VALID_INTERVALS = DEFAULT_INTERVAL,
    profile: VALID_PROFILES = "full_confluence",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Compact Elliott/Fib summary for badges and confirmation cards."""
    settings = await get_app_settings(db)
    if not settings["enable_elliott_wave"]:
        raise HTTPException(status_code=404, detail="Elliott Wave module is disabled")
    result = await get_wave_summary(
        ticker.upper(),
        period=period,
        interval=interval,
        profile=profile,
    )
    return result


@router.post("/wave/{ticker}/analyze")
async def post_ticker_wave_analyze(
    ticker: str,
    body: WaveAnalyzeRequest = WaveAnalyzeRequest(),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Full analysis including chart payload for Plotly rendering."""
    settings = await get_app_settings(db)
    if not settings["enable_elliott_wave"]:
        raise HTTPException(status_code=404, detail="Elliott Wave module is disabled")
    result = await analyze_wave(
        ticker.upper(),
        period=body.period,
        interval=body.interval,
        profile=body.profile,
    )
    if result is None:
        raise HTTPException(
            status_code=400,
            detail=f"Wave analysis unavailable for {ticker.upper()}",
        )
    return result


@router.get("/portfolio/{portfolio_id}/wave")
async def get_portfolio_wave_summaries(
    portfolio_id: UUID,
    period: VALID_PERIODS = DEFAULT_PERIOD,
    interval: VALID_INTERVALS = DEFAULT_INTERVAL,
    profile: VALID_PROFILES = "full_confluence",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Batch wave summaries for all holdings in the latest portfolio snapshot."""
    settings = await get_app_settings(db)
    if not settings["enable_elliott_wave"]:
        return {}

    p_result = await db.execute(
        select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id)
    )
    if not p_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Portfolio not found")

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(PortfolioSnapshot.uploaded_at.desc())
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot or not snapshot.holdings:
        return {}

    tickers = [h.ticker for h in snapshot.holdings]
    return await get_wave_summaries_for_portfolio(
        tickers,
        period=period,
        interval=interval,
        profile=profile,
    )
