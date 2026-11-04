"""The seven-question judgment battery: one call, seven typed answers."""

from __future__ import annotations

from .split import assert_split_respected


def build_questions() -> dict:
    questions = {
        "regime": {
            "type": "choice",
            "instructions": "What market regime does this state describe?",
            "criteria": {"trending": None, "mean_reverting": None, "high_vol": None, "crisis": None},
        },
        "direction": {
            "type": "choice",
            "instructions": "What is the price bias over the next 10 ticks?",
            "criteria": {"up": None, "down": None, "neutral": None},
        },
        "toxic_flow": {
            "type": "noul",
            "instructions": "Is the aggressive flow in this state likely informed rather than noise?",
        },
        "liquidity_stressed": {
            "type": "noul",
            "instructions": "Is the order book thinner than its recent norm?",
        },
        "quote_environment": {
            "type": "score",
            "instructions": "How favourable is this state for providing liquidity?",
            "criteria": ["Do not quote", "Marginal", "Standard", "Excellent"],
        },
        "inventory_pressure": {
            "type": "score",
            "instructions": "Given the current inventory, how urgent is it to cut the position?",
            "criteria": ["None", "Mild", "Skew hard", "Reduce now"],
        },
        "execution_health": {
            "type": "score",
            "instructions": (
                "Given recent fill ratio, reject count, slippage, and latency in this "
                "state, is execution quality optimal or degrading?"
            ),
            "criteria": ["Broken", "Degraded", "Normal", "Optimal"],
        },
    }
    assert_split_respected(questions)
    return questions


REQUIRED_ANSWER_KEYS = {
    "noul": {"type", "noul"},
    "choice": {"type", "choice", "probabilities", "confidence"},
    "score": {"type", "score", "probabilities", "confidence"},
}


def validate_answers(answers: dict) -> None:
    """Raise ValueError if the response is missing a question or a field."""
    if not isinstance(answers, dict):
        raise ValueError("battery response is not an object")
    for key, q in build_questions().items():
        if key not in answers:
            raise ValueError(f"battery response missing answer for '{key}'")
        missing = REQUIRED_ANSWER_KEYS[q["type"]] - set(answers[key].keys())
        if missing:
            raise ValueError(f"answer '{key}' missing fields {sorted(missing)}")
