"""System-wide application settings endpoints."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User, UserRole
from app.services.settings_service import SettingsDataError, get_app_settings, update_app_settings

router = APIRouter()
logger = logging.getLogger(__name__)


class AppSettingsUpdate(BaseModel):
    observation_covariance: float = Field(ge=0.0001, le=10.0)
    transition_covariance: float = Field(ge=0.0001, le=1.0)
    processing_mode: Literal["causal", "historical"] = "causal"
    enable_kalman_filter: bool = True
    enable_elliott_wave: bool = True
    enable_markov_regime: bool = True


@router.get("/settings")
async def get_current_app_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return system-wide settings for all authenticated users."""
    return await get_app_settings(db)


@router.put("/settings")
async def put_app_settings(
    body: AppSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update system-wide settings. Admin-only."""
    if user.role != UserRole.admin:
        logger.warning(
            "settings update denied for user_id=%s email=%s role=%s",
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
