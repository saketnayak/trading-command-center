import math

import pytest

from jev_loop.calibrate import brier_score, calibration_report, pair_predictions, reliability_table

pytestmark = pytest.mark.unit


def test_calibration_scores_direction_confidence_only():
    ticks = [
        {"direction": "up", "direction_conf": 0.9, "quote_environment_conf": 0.1, "mid": 100},
        {"direction": "down", "direction_conf": 0.6, "quote_environment_conf": 0.9, "mid": 101},
        {"direction": "neutral", "direction_conf": 0.8, "mid": 102},
        {"direction": None, "mid": 99},
    ]
    assert pair_predictions(ticks, horizon=1) == [(0.9, 1), (0.6, 0)]


def test_brier_score_bounds():
    assert brier_score([(1.0, 1), (0.0, 0)]) == 0.0
    assert math.isnan(brier_score([]))


def test_reliability_table_has_ten_bins():
    rows = reliability_table([(0.95, 1), (0.05, 0)])
    assert len(rows) == 10 and rows[9]["n"] == 1 and rows[0]["n"] == 1


def test_calibration_report_is_json_safe_when_empty():
    report = calibration_report([], horizon=5)
    assert report["n"] == 0 and report["brier"] is None
