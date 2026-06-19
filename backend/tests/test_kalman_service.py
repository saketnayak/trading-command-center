import time
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from app.services.kalman_service import (
    KalmanDataError,
    _compute_signal,
    apply_kalman_filter,
    get_kalman,
    prepare_price_series,
)

pytestmark = pytest.mark.unit


def make_price_frame(values: list[float], column: str = "Adj Close") -> pd.DataFrame:
    idx = pd.date_range("2020-01-01", periods=len(values), freq="B")
    return pd.DataFrame({column: values}, index=idx)


def test_prepare_price_series_prefers_adjusted_close():
    data = pd.DataFrame(
        {
            "Adj Close": [100.0, 101.0, None, np.inf, 102.0] + [103.0] * 17,
            "Close": [1.0] * 22,
        },
        index=pd.date_range("2020-01-01", periods=22, freq="B"),
    )

    price = prepare_price_series(data)

    assert price.name == "price"
    assert price.iloc[0] == pytest.approx(100.0)
    assert len(price) == 20


def test_prepare_price_series_falls_back_to_close():
    data = make_price_frame([100.0 + i for i in range(25)], column="Close")

    price = prepare_price_series(data)

    assert len(price) == 25
    assert price.iloc[-1] == pytest.approx(124.0)


def test_apply_kalman_filter_returns_required_columns():
    price = pd.Series(
        [100.0 + i * 0.5 for i in range(40)],
        index=pd.date_range("2020-01-01", periods=40, freq="B"),
        name="price",
    )

    result = apply_kalman_filter(price)

    assert list(result.columns) == [
        "price",
        "kalman_price",
        "kalman_trend",
        "filtered_price",
        "filtered_trend",
        "smoothed_price",
        "smoothed_trend",
    ]
    assert len(result) == 40
    assert np.isfinite(result["kalman_price"]).all()
    assert np.isfinite(result["kalman_trend"]).all()
    pd.testing.assert_series_equal(result["kalman_price"], result["filtered_price"], check_names=False)


def test_apply_kalman_filter_historical_mode_uses_smoothed_state():
    price = pd.Series(
        [100.0 + i * 0.5 for i in range(40)],
        index=pd.date_range("2020-01-01", periods=40, freq="B"),
        name="price",
    )

    result = apply_kalman_filter(price, real_time=False)

    pd.testing.assert_series_equal(result["kalman_price"], result["smoothed_price"], check_names=False)
    pd.testing.assert_series_equal(result["kalman_trend"], result["smoothed_trend"], check_names=False)


def test_apply_kalman_filter_zero_lag_initialization_tracks_first_price():
    price = pd.Series([100.0] + [105.0 + i for i in range(24)])

    result = apply_kalman_filter(price)

    assert result["filtered_price"].iloc[0] == pytest.approx(100.0, abs=1e-3)


def test_apply_kalman_filter_rejects_bad_matrix_shape():
    price = pd.Series([100.0 + i for i in range(25)])

    with pytest.raises(KalmanDataError, match="transition_matrix"):
        apply_kalman_filter(price, transition_matrix=[[1.0]])


def test_apply_kalman_filter_rejects_bad_covariance_shape():
    price = pd.Series([100.0 + i for i in range(25)])

    with pytest.raises(KalmanDataError, match="observation_covariance"):
        apply_kalman_filter(price, observation_covariance=[[1.0, 0.0]])


def test_apply_kalman_filter_rejects_insufficient_data():
    price = pd.Series([100.0 + i for i in range(10)])

    with pytest.raises(KalmanDataError, match="At least 20"):
        apply_kalman_filter(price)


def test_compute_signal_is_bounded():
    assert _compute_signal(10.0, 100.0) <= 1.0
    assert _compute_signal(-10.0, 100.0) >= -1.0
    assert _compute_signal(0.0, 100.0) == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_cache_hit_skips_recompute():
    from app.services import kalman_service

    fake_result = {"ticker": "TEST", "signal": 0.5, "trend_direction": "up"}
    kalman_service._kalman_cache["TEST:2015-01-01::1d:True:0.01:0.01:0.1"] = (
        fake_result,
        time.time() + 3600,
    )

    with patch(
        "app.services.kalman_service.resolve_quote_currency",
        return_value="USD",
    ) as mock_currency:
        result = await get_kalman("TEST")

    assert result == {**fake_result, "currency": "USD"}
    mock_currency.assert_awaited_once_with("TEST")


@pytest.mark.asyncio
async def test_cache_hit_preserves_existing_currency():
    from app.services import kalman_service

    fake_result = {"ticker": "TEST", "signal": 0.5, "trend_direction": "up", "currency": "EUR"}
    kalman_service._kalman_cache["TEST:2015-01-01::1d:True:0.01:0.01:0.1"] = (
        fake_result,
        time.time() + 3600,
    )

    with patch("app.services.kalman_service.resolve_quote_currency") as mock_currency:
        result = await get_kalman("TEST")

    assert result == fake_result
    mock_currency.assert_not_called()


@pytest.mark.asyncio
async def test_cache_miss_on_expired():
    from app.services import kalman_service

    fake_result = {"ticker": "TEST2", "signal": 0.5, "trend_direction": "up"}
    fake_data = make_price_frame([100.0 + i for i in range(25)])
    kalman_service._kalman_cache["TEST2:2015-01-01::1d:True:0.01:0.01:0.1"] = (
        fake_result,
        time.time() - 1,
    )

    with (
        patch("app.services.kalman_service.download_price_data", return_value=fake_data) as mock_download,
        patch("app.services.kalman_service._compute_kalman", return_value=None) as mock_compute,
    ):
        result = await get_kalman("TEST2")

    assert result is None
    mock_download.assert_awaited_once_with("TEST2", start="2015-01-01", end=None, interval="1d")
    mock_compute.assert_called_once()
    args = mock_compute.call_args.args
    pd.testing.assert_frame_equal(args[0], fake_data)
    assert args[1:] == ("TEST2", "2015-01-01", None, "1d", True, 0.01, 0.01, 0.1)


@pytest.mark.asyncio
async def test_get_kalman_rejects_invalid_covariance():
    with pytest.raises(KalmanDataError, match="observation_covariance"):
        await get_kalman("TEST3", observation_covariance=0.0)


@pytest.mark.asyncio
async def test_get_kalman_rejects_out_of_range_transition_covariance():
    with pytest.raises(KalmanDataError, match="transition_covariance_level"):
        await get_kalman("TEST4", transition_covariance_level=1.1)
