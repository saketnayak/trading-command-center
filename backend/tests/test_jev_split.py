import pytest

from jev_loop.battery import build_questions, validate_answers
from jev_loop.split import ALLOWED_QUESTIONS, SplitViolation, assert_split_respected, split_rows

pytestmark = pytest.mark.unit


def test_the_real_battery_respects_the_split():
    assert_split_respected(build_questions())


def test_battery_asks_exactly_the_seven_allowed_questions():
    assert set(build_questions()) == set(ALLOWED_QUESTIONS)


def test_unknown_question_id_is_rejected():
    with pytest.raises(SplitViolation):
        assert_split_respected({"a_new_thing": {"type": "noul", "instructions": "is this ok"}})


def test_arithmetic_instructions_are_rejected_even_on_an_allowed_id():
    with pytest.raises(SplitViolation):
        assert_split_respected(
            {"regime": {"type": "choice", "instructions": "Please calculate the regime.", "criteria": {}}}
        )


def test_structured_instructions_are_also_scanned():
    with pytest.raises(SplitViolation):
        assert_split_respected(
            {
                "toxic_flow": {
                    "type": "noul",
                    "instructions": {"data": {"mid": 100}, "question": "Compute the exact value of the spread."},
                }
            }
        )


def test_legitimate_judgment_passes():
    assert_split_respected(
        {"toxic_flow": {"type": "noul", "instructions": "Is the aggressive flow informed rather than noise?"}}
    )


def test_validate_answers_rejects_missing_answer():
    with pytest.raises(ValueError):
        validate_answers({})


def test_split_rows_name_both_sides():
    rows = split_rows()
    assert rows["deterministic"] and rows["probabilistic"]
    assert any("state.py" in module for _, module in rows["deterministic"])
