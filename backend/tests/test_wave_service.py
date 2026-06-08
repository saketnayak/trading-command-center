"""Unit tests for wave service helpers (no yfinance)."""

import pytest

from app.services.wave_service import _build_projection, _to_summary

pytestmark = pytest.mark.unit


def test_to_summary_extracts_overview_fields() -> None:
    payload = {
        "overview": {
            "top_scenario": "impulse/long",
            "top_direction": "long",
            "warnings": ["low data"],
            "trade_region": None,
        },
        "top_scenarios": [
            {
                "pattern": "impulse",
                "trend": "long",
                "score": 80.0,
                "invalidation_level": 140.5,
            }
        ],
        "trade_regions": [
            {
                "direction": "long",
                "zone_low": 170.0,
                "zone_high": 175.0,
                "confidence": 66.0,
            }
        ],
    }
    summary = _to_summary(payload, "aapl")
    assert summary["ticker"] == "AAPL"
    assert summary["top_scenario"] == "impulse/long"
    assert summary["top_direction"] == "long"
    assert summary["pattern"] == "impulse"
    assert summary["zone_low"] == 170.0
    assert summary["confidence"] == 66.0
    assert summary["warnings"] == ["low data"]


def test_build_projection_adds_forward_fibonacci_path() -> None:
    payload = {
        "chart": {
            "ohlcv": [
                {"time": "2026-01-01T00:00:00+00:00", "close": 100.0},
                {"time": "2026-01-02T00:00:00+00:00", "close": 110.0},
            ]
        },
        "top_scenarios": [
            {
                "pattern": "impulse",
                "trend": "long",
                "score": 80.0,
                "invalidation_level": 95.0,
                "legs": [
                    {
                        "start_idx": 0,
                        "end_idx": 10,
                        "start_price": 90.0,
                        "end_price": 110.0,
                    }
                ],
            }
        ],
        "trade_regions": [{"confidence": 70.0}],
    }

    projection = _build_projection(payload)

    assert projection is not None
    assert projection["direction"] == "up"
    assert projection["primary_target"] == 130.0
    assert len(projection["path"]) == 4
    assert projection["levels"][0]["label"] == "0.618 extension"
