"""Kalman filter analysis endpoints."""
from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import PortfolioSnapshot
from app.models.user import User, UserRole
from app.routers.portfolio import _verify_portfolio_access
from app.services.kalman_service import (
    KalmanDataError,
    get_kalman,
    get_kalman_for_portfolio,
)
from app.services.settings_service import SettingsDataError, get_app_settings, update_app_settings

router = APIRouter()
logger = logging.getLogger(__name__)


class KalmanSettingsUpdate(BaseModel):
    observation_covariance: float = Field(ge=0.0001, le=10.0)
    transition_covariance: float = Field(ge=0.0001, le=1.0)
    processing_mode: Literal["causal", "historical"] = "causal"
    enable_kalman_filter: bool = True
    enable_elliott_wave: bool = True
    enable_markov_regime: bool = True


@router.get("/kalman/settings")
async def get_current_kalman_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return system-wide Kalman defaults for all authenticated users."""
    return await get_app_settings(db)


@router.put("/kalman/settings")
async def put_kalman_settings(
    body: KalmanSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update system-wide Kalman defaults. Admin-only."""
    if user.role != UserRole.admin:
        logger.warning(
            "kalman settings update denied for user_id=%s email=%s role=%s",
            user.id,
            user.email,
            user.role.value if hasattr(user.role, "value") else user.role,
        )
        raise HTTPException(status_code=403, detail="Admin required")

    try:
        return await update_app_settings(
            db,
            observation_covariance=body.observation_covariance,
            transition_covariance=body.transition_covariance,
            processing_mode=body.processing_mode,
            enable_kalman_filter=body.enable_kalman_filter,
            enable_elliott_wave=body.enable_elliott_wave,
            enable_markov_regime=body.enable_markov_regime,
        )
    except SettingsDataError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/kalman/{ticker}")
async def get_ticker_kalman(
    ticker: str,
    start: str = "2015-01-01",
    end: str | None = None,
    interval: str = "1d",
    real_time: bool | None = None,
    transition_covariance_level: float | None = None,
    transition_covariance_trend: float | None = None,
    observation_covariance: float | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return Kalman trend analysis for a single ticker.

    Returns null if yfinance data is unavailable or computation fails.
    """
    try:
        settings = await get_app_settings(db)
        if not settings["enable_kalman_filter"]:
            raise HTTPException(status_code=404, detail="Kalman filter module is disabled")
        default_real_time = settings["processing_mode"] == "causal"
        default_q = settings["transition_covariance"]
        default_r = settings["observation_covariance"]
        return await get_kalman(
            ticker.upper(),
            start=start,
            end=end,
            interval=interval,
            real_time=default_real_time if real_time is None else real_time,
            transition_covariance_level=default_q if transition_covariance_level is None else transition_covariance_level,
            transition_covariance_trend=default_q if transition_covariance_trend is None else transition_covariance_trend,
            observation_covariance=default_r if observation_covariance is None else observation_covariance,
        )
    except KalmanDataError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/portfolio/{portfolio_id}/kalman")
async def get_portfolio_kalman(
    portfolio_id: UUID,
    real_time: bool | None = None,
    transition_covariance_level: float | None = None,
    transition_covariance_trend: float | None = None,
    observation_covariance: float | None = None,
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
        settings = await get_app_settings(db)
        if not settings["enable_kalman_filter"]:
            return {}
        default_real_time = settings["processing_mode"] == "causal"
        default_q = settings["transition_covariance"]
        default_r = settings["observation_covariance"]
        return await get_kalman_for_portfolio(
            tickers,
            real_time=default_real_time if real_time is None else real_time,
            transition_covariance_level=default_q if transition_covariance_level is None else transition_covariance_level,
            transition_covariance_trend=default_q if transition_covariance_trend is None else transition_covariance_trend,
            observation_covariance=default_r if observation_covariance is None else observation_covariance,
        )
    except KalmanDataError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
