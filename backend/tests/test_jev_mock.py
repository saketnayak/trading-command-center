import pytest

from jev_loop.battery import build_questions, validate_answers
from jev_loop.limits import Limits
from jev_loop.mock import MockDecisionModel

pytestmark = pytest.mark.unit


def test_mock_answers_validate_against_battery_schema():
    answers, meta = MockDecisionModel(seed=42).ask({"imbalance": 0.2, "inventory": 0.0005, "mid": 85_000.0}, build_questions())
    validate_answers(answers)
    assert meta["model"].startswith("mock-") and meta["route"] == "MOCK"


def test_mock_never_claims_to_be_real():
    m = MockDecisionModel()
    assert "mock" in m.model.lower() and m.name == "MOCK"


def test_mock_choice_probabilities_sum_to_one():
    answers, _ = MockDecisionModel(seed=1).ask({"imbalance": 0.1}, build_questions())
    for key in ("regime", "direction"):
        assert abs(sum(answers[key]["probabilities"].values()) - 1.0) < 1e-3


# -- regression: upstream sized inventory pressure in BTC units ---------------


def test_inventory_pressure_is_measured_in_dollars_not_units():
    cap = Limits().max_position_usd
    near_cap = MockDecisionModel(seed=3, max_position_usd=cap).ask(
        {"inventory": 0.0005, "mid": 90_000.0}, build_questions()  # $45 of a $50 cap
    )[0]["inventory_pressure"]["score"]
    tiny = MockDecisionModel(seed=3, max_position_usd=cap).ask(
        {"inventory": 0.0005, "mid": 30.0}, build_questions()  # $0.015
    )[0]["inventory_pressure"]["score"]
    assert near_cap > 2.0 > 0.5 > tiny
