import time
import numpy as np
import pandas as pd
import pytest
from unittest.mock import AsyncMock, patch

pytest.mark.unit
pytestmark = pytest.mark.unit

from app.services.markov_service import (
    _label_regimes,
    _build_transition_matrix,
    _compute_signal,
    _compute_stationary,
    _walk_forward_stats,
    _regime_cache,
)


def make_close(values: list[float]) -> pd.Series:
    idx = pd.date_range("2020-01-01", periods=len(values), freq="B")
    return pd.Series(values, index=idx, name="Close")


def test_label_regimes_bull():
    # 21 prices where rolling 20-day return > 5%
    prices = [100.0] + [100.0 * 1.003 ** i for i in range(1, 21)]
    close = make_close(prices)
    labels = _label_regimes(close, window=20, threshold=0.05)
    assert labels.iloc[-1] == 2  # Bull


def test_label_regimes_bear():
    # 21 prices where rolling 20-day return < -5%
    prices = [100.0] + [100.0 * 0.997 ** i for i in range(1, 21)]
    close = make_close(prices)
    labels = _label_regimes(close, window=20, threshold=0.05)
    assert labels.iloc[-1] == 0  # Bear


def test_label_regimes_sideways():
    # flat prices -> rolling return ~0 -> Sideways
    close = make_close([100.0] * 30)
    labels = _label_regimes(close, window=20, threshold=0.05)
    assert labels.iloc[-1] == 1  # Sideways


def test_transition_matrix_shape_and_rows_sum_to_one():
    labels = pd.Series([2, 0, 2, 0, 2, 0, 2, 0, 2, 0])
    P = _build_transition_matrix(labels)
    assert P.shape == (3, 3)
    np.testing.assert_allclose(P.sum(axis=1), 1.0, atol=1e-9)


def test_transition_matrix_known_transitions():
    # Only Bull->Bear transitions from Bull rows
    labels = pd.Series([2, 0, 2, 0, 2, 0])
    P = _build_transition_matrix(labels)
    assert P[2, 0] == pytest.approx(1.0)
    assert P[2, 1] == pytest.approx(0.0)
    assert P[2, 2] == pytest.approx(0.0)


def test_signal_bull():
    assert _compute_signal(bull_prob=0.8, bear_prob=0.1) == pytest.approx(0.7)


def test_signal_bear():
    assert _compute_signal(bull_prob=0.1, bear_prob=0.8) == pytest.approx(-0.7)


def test_stationary_sums_to_one():
    P = np.array([
        [0.82, 0.12, 0.06],
        [0.14, 0.71, 0.15],
        [0.04, 0.18, 0.78],
    ])
    stat = _compute_stationary(P)
    assert abs(sum(stat.values()) - 1.0) < 1e-6
    assert all(v >= 0 for v in stat.values())


@pytest.mark.asyncio
async def test_cache_hit_skips_recompute():
    from app.services import markov_service
    fake_result = {"ticker": "TEST", "signal": 0.5, "current_regime": "Bull"}
    markov_service._regime_cache["TEST"] = (fake_result, time.time() + 3600)
    result = await markov_service.get_regime("TEST")
    assert result == fake_result


@pytest.mark.asyncio
async def test_cache_miss_on_expired():
    from app.services import markov_service

    fake_result = {"ticker": "TEST2", "signal": 0.5, "current_regime": "Bull"}
    fake_data = pd.DataFrame(
        {"Close": [100.0 + i for i in range(300)]},
        index=pd.date_range("2020-01-01", periods=300, freq="B"),
    )
    markov_service._regime_cache["TEST2"] = (fake_result, time.time() - 1)  # expired
    with (
        patch(
            "app.services.markov_service.fetch_history_period",
            new=AsyncMock(return_value=fake_data),
        ) as mock_fetch,
        patch("app.services.markov_service._compute_regime", return_value=None) as mock_compute,
    ):
        result = await markov_service.get_regime("TEST2")
    assert result is None
    mock_fetch.assert_awaited_once_with("TEST2", period="10y", interval="1d", auto_adjust=True)
    mock_compute.assert_called_once_with(fake_data, "TEST2")


def test_walk_forward_stats_returns_sharpe_and_drawdown():
    # 500 prices with upward trend -> enough Bull regime days for walk-forward to run
    prices = [100.0 * 1.0005 ** i for i in range(500)]
    close = make_close(prices)
    labels = _label_regimes(close, window=20, threshold=0.05)
    result = _walk_forward_stats(close, labels, min_train=252)
    assert "sharpe" in result
    assert "max_drawdown" in result
    assert isinstance(result["sharpe"], float)
    assert result["max_drawdown"] <= 0.0


def test_walk_forward_stats_returns_none_when_insufficient_data():
    # Exactly min_train prices -> walk-forward loop has no iterations -> both None
    min_train = 100
    prices = [100.0 * 1.0005 ** i for i in range(min_train)]
    close = make_close(prices)
    labels = _label_regimes(close, window=20, threshold=0.05)
    result = _walk_forward_stats(close, labels, min_train=min_train)
    assert result["sharpe"] is None
    assert result["max_drawdown"] is None


def test_transition_matrix_degenerate_state():
    # No Sideways (state 1) in the sequence -> state 1 row should get uniform fallback
    labels = pd.Series([2, 0, 2, 0, 2, 0])
    P = _build_transition_matrix(labels)
    assert P[1].sum() == pytest.approx(1.0)
