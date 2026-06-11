from __future__ import annotations

import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import AppSettings


_DEFAULT_TRANSITION_COVARIANCE_VALUE = 0.01
_DEFAULT_OBSERVATION_COVARIANCE_VALUE = 0.1
_TRANSITION_COVARIANCE_MIN = 0.0001
_TRANSITION_COVARIANCE_MAX = 1.0
_OBSERVATION_COVARIANCE_MIN = 0.0001
_OBSERVATION_COVARIANCE_MAX = 10.0
_APP_SETTINGS_ID = 1


class SettingsDataError(ValueError):
    """Raised when persisted app settings fail server-side validation."""


def _validate_processing_mode(value: str) -> str:
    if value not in {"causal", "historical"}:
        raise SettingsDataError("processing_mode must be 'causal' or 'historical'")
    return value


def _as_bounded_float(value: float, name: str, minimum: float, maximum: float) -> float:
    numeric = float(value)
    if not np.isfinite(numeric) or numeric < minimum or numeric > maximum:
        raise SettingsDataError(f"{name} must be between {minimum} and {maximum}")
    return numeric


def _settings_to_dict(settings: AppSettings) -> dict:
    return {
        "observation_covariance": settings.observation_covariance,
        "transition_covariance": settings.transition_covariance,
        "processing_mode": settings.processing_mode,
        "enable_kalman_filter": settings.enable_kalman_filter,
        "enable_elliott_wave": settings.enable_elliott_wave,
        "enable_markov_regime": settings.enable_markov_regime,
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
    }


async def get_app_settings(db: AsyncSession) -> dict:
    """Return persisted system-wide settings, creating the singleton row if absent."""
    settings = await db.get(AppSettings, _APP_SETTINGS_ID)
    if settings is None:
        settings = AppSettings(
            id=_APP_SETTINGS_ID,
            observation_covariance=_DEFAULT_OBSERVATION_COVARIANCE_VALUE,
            transition_covariance=_DEFAULT_TRANSITION_COVARIANCE_VALUE,
            processing_mode="causal",
            enable_kalman_filter=True,
            enable_elliott_wave=True,
            enable_markov_regime=True,
        )
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
    return _settings_to_dict(settings)


async def update_app_settings(
    db: AsyncSession,
    observation_covariance: float,
    transition_covariance: float,
    processing_mode: str,
    enable_kalman_filter: bool,
    enable_elliott_wave: bool,
    enable_markov_regime: bool,
) -> dict:
    """Persist system-wide settings after server-side validation."""
    r_value = _as_bounded_float(
        observation_covariance,
        "observation_covariance",
        _OBSERVATION_COVARIANCE_MIN,
        _OBSERVATION_COVARIANCE_MAX,
    )
    q_value = _as_bounded_float(
        transition_covariance,
        "transition_covariance",
        _TRANSITION_COVARIANCE_MIN,
        _TRANSITION_COVARIANCE_MAX,
    )
    mode = _validate_processing_mode(processing_mode)

    settings = await db.get(AppSettings, _APP_SETTINGS_ID)
    if settings is None:
        settings = AppSettings(id=_APP_SETTINGS_ID)
        db.add(settings)

    settings.observation_covariance = r_value
    settings.transition_covariance = q_value
    settings.processing_mode = mode
    settings.enable_kalman_filter = enable_kalman_filter
    settings.enable_elliott_wave = enable_elliott_wave
    settings.enable_markov_regime = enable_markov_regime
    await db.commit()
    await db.refresh(settings)
    return _settings_to_dict(settings)
