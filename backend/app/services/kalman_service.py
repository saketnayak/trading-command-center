"""Kalman trend estimation on yfinance price data."""
from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timezone
from typing import Literal

import numpy as np
import pandas as pd

from app.services.yfinance_service import fetch_history

logger = logging.getLogger(__name__)

_kalman_cache: dict[str, tuple[dict | None, float]] = {}
_CACHE_TTL = 14400  # 4 hours

_VALID_INTERVALS = {"1d", "5d", "1wk", "1mo", "3mo"}
_TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-=]{0,14}$")
_DEFAULT_TRANSITION_COVARIANCE_VALUE = 0.01
_DEFAULT_OBSERVATION_COVARIANCE_VALUE = 0.1
_DEFAULT_TRANSITION_COVARIANCE = np.array(
    [[_DEFAULT_TRANSITION_COVARIANCE_VALUE, 0.0], [0.0, _DEFAULT_TRANSITION_COVARIANCE_VALUE]],
    dtype=float,
)
_DEFAULT_OBSERVATION_COVARIANCE = np.array([[_DEFAULT_OBSERVATION_COVARIANCE_VALUE]], dtype=float)
_DEFAULT_INITIAL_STATE_COVARIANCE = np.eye(2, dtype=float) * 1_000_000.0
_TRANSITION_COVARIANCE_MIN = 0.0001
_TRANSITION_COVARIANCE_MAX = 1.0
_OBSERVATION_COVARIANCE_MIN = 0.0001
_OBSERVATION_COVARIANCE_MAX = 10.0


class KalmanDataError(ValueError):
    """Raised when Kalman inputs or downloaded market data are unusable."""


def _validate_ticker(ticker: str) -> str:
    normalized = ticker.strip().upper()
    if not _TICKER_RE.match(normalized):
        raise KalmanDataError("Ticker must be 1-15 market symbol characters")
    return normalized


def _validate_date(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    try:
        pd.Timestamp(value)
    except Exception as exc:
        raise KalmanDataError(f"{field_name} must be a valid date") from exc
    return value


def _as_matrix(value: object, shape: tuple[int, int], name: str) -> np.ndarray:
    matrix = np.asarray(value, dtype=float)
    if matrix.shape != shape:
        raise KalmanDataError(f"{name} must have shape {shape}")
    if not np.isfinite(matrix).all():
        raise KalmanDataError(f"{name} must contain only finite numbers")
    return matrix


def _as_bounded_float(value: float, name: str, minimum: float, maximum: float) -> float:
    numeric = float(value)
    if not np.isfinite(numeric) or numeric < minimum or numeric > maximum:
        raise KalmanDataError(f"{name} must be between {minimum} and {maximum}")
    return numeric


async def download_price_data(
    ticker: str = "SPY",
    start: str = "2015-01-01",
    end: str | None = None,
    interval: str = "1d",
) -> pd.DataFrame:
    """Fetch historical OHLCV data from yfinance for Kalman analysis."""
    symbol = _validate_ticker(ticker)
    _validate_date(start, "start")
    _validate_date(end, "end")
    if interval not in _VALID_INTERVALS:
        raise KalmanDataError(f"interval must be one of {sorted(_VALID_INTERVALS)}")

    try:
        return await fetch_history(
            symbol,
            start=start,
            end=end,
            interval=interval,
            auto_adjust=False,
        )
    except Exception as exc:
        raise KalmanDataError(f"Failed to download price data for {symbol}") from exc


def prepare_price_series(data: pd.DataFrame) -> pd.Series:
    """Clean OHLCV data and extract adjusted close, falling back to close."""
    if data.empty:
        raise KalmanDataError("Price data is empty")

    column = "Adj Close" if "Adj Close" in data.columns else "Close"
    if column not in data.columns:
        raise KalmanDataError("Price data must include Adj Close or Close")

    price = pd.to_numeric(data[column], errors="coerce")
    price = price.replace([np.inf, -np.inf], np.nan).dropna()
    price = price[price > 0]
    price.name = "price"

    if len(price) < 20:
        raise KalmanDataError("At least 20 valid price observations are required")
    return price


def apply_kalman_filter(
    price: pd.Series,
    transition_matrix: object | None = None,
    observation_matrix: object | None = None,
    transition_covariance: object | None = None,
    observation_covariance: object | None = None,
    initial_state_mean: object | None = None,
    initial_state_covariance: object | None = None,
    real_time: bool = True,
) -> pd.DataFrame:
    """Apply a 2-state Kalman model and return price, selected estimate, and trend.

    When ``real_time`` is true, ``kalman_price`` and ``kalman_trend`` come from
    ``KalmanFilter.filter()`` and are suitable for live tracking/backtests. When
    false, they come from ``KalmanFilter.smooth()`` for offline historical work.
    """
    clean_price = pd.to_numeric(price, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    clean_price = clean_price[clean_price > 0]
    if len(clean_price) < 20:
        raise KalmanDataError("At least 20 valid price observations are required")

    transition = _as_matrix(
        transition_matrix if transition_matrix is not None else [[1.0, 1.0], [0.0, 1.0]],
        (2, 2),
        "transition_matrix",
    )
    observation = _as_matrix(
        observation_matrix if observation_matrix is not None else [[1.0, 0.0]],
        (1, 2),
        "observation_matrix",
    )
    transition_cov = _as_matrix(
        transition_covariance if transition_covariance is not None else _DEFAULT_TRANSITION_COVARIANCE,
        (2, 2),
        "transition_covariance",
    )
    observation_cov = _as_matrix(
        observation_covariance if observation_covariance is not None else _DEFAULT_OBSERVATION_COVARIANCE,
        (1, 1),
        "observation_covariance",
    )
    state_mean = np.asarray(
        initial_state_mean if initial_state_mean is not None else [float(clean_price.iloc[0]), 0.0],
        dtype=float,
    )
    if state_mean.shape != (2,) or not np.isfinite(state_mean).all():
        raise KalmanDataError("initial_state_mean must have shape (2,)")
    state_cov = _as_matrix(
        initial_state_covariance if initial_state_covariance is not None else _DEFAULT_INITIAL_STATE_COVARIANCE,
        (2, 2),
        "initial_state_covariance",
    )

    from pykalman import KalmanFilter

    kf = KalmanFilter(
        transition_matrices=transition,
        observation_matrices=observation,
        transition_covariance=transition_cov,
        observation_covariance=observation_cov,
        initial_state_mean=state_mean,
        initial_state_covariance=state_cov,
    )

    observations = clean_price.to_numpy(dtype=float).reshape(-1, 1)
    smoothed_state, _ = kf.smooth(observations)
    filtered_state, _ = kf.filter(observations)
    selected_state = filtered_state if real_time else smoothed_state

    return pd.DataFrame(
        {
            "price": clean_price,
            "kalman_price": selected_state[:, 0],
            "kalman_trend": selected_state[:, 1],
            "filtered_price": filtered_state[:, 0],
            "filtered_trend": filtered_state[:, 1],
            "smoothed_price": smoothed_state[:, 0],
            "smoothed_trend": smoothed_state[:, 1],
        },
        index=clean_price.index,
    )


def plot_kalman_result(result: pd.DataFrame) -> dict:
    """Format a Kalman result frame as a compact chart payload for the UI."""
    tail = result.tail(160)
    return {
        "dates": [idx.date().isoformat() if hasattr(idx, "date") else str(idx) for idx in tail.index],
        "price": [round(float(v), 4) for v in tail["price"]],
        "kalman_price": [round(float(v), 4) for v in tail["kalman_price"]],
        "kalman_trend": [round(float(v), 6) for v in tail["kalman_trend"]],
    }


def _compute_signal(filtered_trend: float, price: float) -> float:
    """Scale the causal trend estimate into a bounded -1..1 signal."""
    if price <= 0:
        return 0.0
    return round(float(np.tanh((filtered_trend / price) * 100.0)), 4)


def _compute_kalman(
    data: pd.DataFrame,
    ticker: str,
    start: str = "2015-01-01",
    end: str | None = None,
    interval: str = "1d",
    real_time: bool = True,
    transition_covariance_level: float = _DEFAULT_TRANSITION_COVARIANCE_VALUE,
    transition_covariance_trend: float = _DEFAULT_TRANSITION_COVARIANCE_VALUE,
    observation_covariance: float = _DEFAULT_OBSERVATION_COVARIANCE_VALUE,
) -> dict | None:
    """Synchronous computation; run via asyncio.to_thread."""
    symbol = _validate_ticker(ticker)
    try:
        q_level = _as_bounded_float(
            transition_covariance_level,
            "transition_covariance_level",
            _TRANSITION_COVARIANCE_MIN,
            _TRANSITION_COVARIANCE_MAX,
        )
        q_trend = _as_bounded_float(
            transition_covariance_trend,
            "transition_covariance_trend",
            _TRANSITION_COVARIANCE_MIN,
            _TRANSITION_COVARIANCE_MAX,
        )
        r_value = _as_bounded_float(
            observation_covariance,
            "observation_covariance",
            _OBSERVATION_COVARIANCE_MIN,
            _OBSERVATION_COVARIANCE_MAX,
        )
        price = prepare_price_series(data)
        result = apply_kalman_filter(
            price,
            transition_covariance=[[q_level, 0.0], [0.0, q_trend]],
            observation_covariance=[[r_value]],
            real_time=real_time,
        )

        latest = result.iloc[-1]
        signal = _compute_signal(float(latest["kalman_trend"]), float(latest["price"]))
        trend_direction: Literal["up", "down", "flat"]
        if signal >= 0.05:
            trend_direction = "up"
        elif signal <= -0.05:
            trend_direction = "down"
        else:
            trend_direction = "flat"

        return {
            "ticker": symbol,
            "start": start,
            "end": end,
            "interval": interval,
            "mode": "causal" if real_time else "historical",
            "real_time": real_time,
            "transition_covariance": [[q_level, 0.0], [0.0, q_trend]],
            "observation_covariance": [[r_value]],
            "latest_price": round(float(latest["price"]), 4),
            "kalman_price": round(float(latest["kalman_price"]), 4),
            "kalman_trend": round(float(latest["kalman_trend"]), 6),
            "filtered_trend": round(float(latest["filtered_trend"]), 6),
            "smoothed_trend": round(float(latest["smoothed_trend"]), 6),
            "signal": signal,
            "trend_direction": trend_direction,
            "observations": int(len(result)),
            "chart": plot_kalman_result(result),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception:
        logger.exception("kalman: computation failed for %s", symbol)
        return None


async def get_kalman(
    ticker: str,
    start: str = "2015-01-01",
    end: str | None = None,
    interval: str = "1d",
    real_time: bool = True,
    transition_covariance_level: float = _DEFAULT_TRANSITION_COVARIANCE_VALUE,
    transition_covariance_trend: float = _DEFAULT_TRANSITION_COVARIANCE_VALUE,
    observation_covariance: float = _DEFAULT_OBSERVATION_COVARIANCE_VALUE,
) -> dict | None:
    """Return Kalman trend analysis for a ticker, from cache or freshly computed."""
    symbol = _validate_ticker(ticker)
    _validate_date(start, "start")
    _validate_date(end, "end")
    if interval not in _VALID_INTERVALS:
        raise KalmanDataError(f"interval must be one of {sorted(_VALID_INTERVALS)}")
    q_level = _as_bounded_float(
        transition_covariance_level,
        "transition_covariance_level",
        _TRANSITION_COVARIANCE_MIN,
        _TRANSITION_COVARIANCE_MAX,
    )
    q_trend = _as_bounded_float(
        transition_covariance_trend,
        "transition_covariance_trend",
        _TRANSITION_COVARIANCE_MIN,
        _TRANSITION_COVARIANCE_MAX,
    )
    r_value = _as_bounded_float(
        observation_covariance,
        "observation_covariance",
        _OBSERVATION_COVARIANCE_MIN,
        _OBSERVATION_COVARIANCE_MAX,
    )
    cache_key = f"{symbol}:{start}:{end or ''}:{interval}:{real_time}:{q_level}:{q_trend}:{r_value}"
    now = time.time()
    if cache_key in _kalman_cache:
        result, expiry = _kalman_cache[cache_key]
        if now < expiry:
            return result

    try:
        data = await download_price_data(symbol, start=start, end=end, interval=interval)
    except KalmanDataError:
        logger.exception("kalman: computation failed for %s", symbol)
        result = None
        ttl = 300
        _kalman_cache[cache_key] = (result, now + ttl)
        return result

    result = await asyncio.to_thread(
        _compute_kalman,
        data,
        symbol,
        start,
        end,
        interval,
        real_time,
        q_level,
        q_trend,
        r_value,
    )

    ttl = _CACHE_TTL if result is not None else 300
    _kalman_cache[cache_key] = (result, now + ttl)
    return result


async def get_kalman_for_portfolio(
    tickers: list[str],
    real_time: bool = True,
    transition_covariance_level: float = _DEFAULT_TRANSITION_COVARIANCE_VALUE,
    transition_covariance_trend: float = _DEFAULT_TRANSITION_COVARIANCE_VALUE,
    observation_covariance: float = _DEFAULT_OBSERVATION_COVARIANCE_VALUE,
) -> dict[str, dict]:
    """Return Kalman trend analysis for all tickers concurrently, dropping failures."""
    normalized = [_validate_ticker(t) for t in tickers]
    results = await asyncio.gather(
        *[
            get_kalman(
                t,
                real_time=real_time,
                transition_covariance_level=transition_covariance_level,
                transition_covariance_trend=transition_covariance_trend,
                observation_covariance=observation_covariance,
            )
            for t in normalized
        ]
    )
    return {t: r for t, r in zip(normalized, results) if r is not None}
