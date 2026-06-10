"""Kalman filter analysis endpoints."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import PortfolioSnapshot
from app.models.user import User
from app.routers.portfolio import _verify_portfolio_access
from app.services.kalman_service import KalmanDataError, get_kalman, get_kalman_for_portfolio

router = APIRouter()


@router.get("/kalman/{ticker}")
async def get_ticker_kalman(
    ticker: str,
    start: str = "2015-01-01",
    end: str | None = None,
    interval: str = "1d",
    real_time: bool = True,
    transition_covariance_level: float = 0.001,
    transition_covariance_trend: float = 0.0001,
    observation_covariance: float = 1.0,
    user: User = Depends(get_current_user),
):
    """Return Kalman trend analysis for a single ticker.

    Returns null if yfinance data is unavailable or computation fails.
    """
    try:
        return await get_kalman(
            ticker.upper(),
            start=start,
            end=end,
            interval=interval,
            real_time=real_time,
            transition_covariance_level=transition_covariance_level,
            transition_covariance_trend=transition_covariance_trend,
            observation_covariance=observation_covariance,
        )
    except KalmanDataError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/portfolio/{portfolio_id}/kalman")
async def get_portfolio_kalman(
    portfolio_id: UUID,
    real_time: bool = True,
    transition_covariance_level: float = 0.001,
    transition_covariance_trend: float = 0.0001,
    observation_covariance: float = 1.0,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return Kalman trend analysis for all tickers in the latest portfolio snapshot."""
    await _verify_portfolio_access(portfolio_id, user.id, db)

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot or not snapshot.holdings:
        return {}

    tickers = [h.ticker for h in snapshot.holdings]
    try:
        return await get_kalman_for_portfolio(
            tickers,
            real_time=real_time,
            transition_covariance_level=transition_covariance_level,
            transition_covariance_trend=transition_covariance_trend,
            observation_covariance=observation_covariance,
        )
    except KalmanDataError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
