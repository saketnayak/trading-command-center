"""The split, enforced: the allow-list of battery questions and the guard
that refuses any question that looks like arithmetic."""

from __future__ import annotations

# question id -> (Jev question type, the judgment it makes)
ALLOWED_QUESTIONS: dict[str, tuple[str, str]] = {
    "regime": ("choice", "is the market trending, mean reverting, high vol, or in crisis"),
    "direction": ("choice", "price bias over the next few ticks, a judgment, not a forecast formula"),
    "toxic_flow": ("noul", "is the aggressive flow informed rather than noise"),
    "liquidity_stressed": ("noul", "is the book thinner than its recent norm"),
    "quote_environment": ("score", "how favourable this state is for providing liquidity"),
    "inventory_pressure": ("score", "how urgent it is to cut the current position"),
    "execution_health": ("score", "whether execution quality is optimal or degrading"),
}

_ARITHMETIC_MARKERS = (
    "calculate",
    "compute the",
    "what is the exact",
    "sum of",
    "average of",
    "mean of",
    "add up",
    "multiply",
    "divide by",
    "vwap",
    "moving average",
    "standard deviation",
    "variance of",
    "exact value",
    "precise value",
    "spread in bps",
    "mid price of",
)


class SplitViolation(Exception):
    pass


def _instructions_text(instructions) -> str:
    if isinstance(instructions, str):
        return instructions
    if isinstance(instructions, dict):
        return " ".join(_instructions_text(v) for v in instructions.values())
    if isinstance(instructions, list):
        return " ".join(_instructions_text(v) for v in instructions)
    return str(instructions)


def assert_split_respected(questions: dict) -> None:
    for qid, question in questions.items():
        if qid not in ALLOWED_QUESTIONS:
            raise SplitViolation(
                f"question '{qid}' is not on the allow-list in jev_loop/split.py"
            )
        text = _instructions_text(question.get("instructions", "")).lower()
        for marker in _ARITHMETIC_MARKERS:
            if marker in text:
                raise SplitViolation(
                    f"question '{qid}' looks like arithmetic (found '{marker}'); compute it in state.py"
                )


def split_rows() -> dict[str, list[tuple[str, str]]]:
    """Both sides of the split with the module that owns each row, for the UI."""
    return {
        "deterministic": [
            ("Exact arithmetic: mid-price, microprice, spread, order book imbalance", "state.py"),
            ("Hard metrics: live inventory, drawdown, session VWAP", "state.py"),
            ("Safety and policy: stop-losses, risk vetoes, routing orders", "risk.py, policy.py, order_plan.py"),
        ],
        "probabilistic": [
            ("Fuzzy conditions: trending, mean reverting, chaotic", "battery.py: regime, direction"),
            ("Order quality: is flow toxic/informed or noise", "battery.py: toxic_flow, liquidity_stressed"),
            (
                "Execution health: is setup quality optimal or degrading",
                "battery.py: quote_environment, inventory_pressure, execution_health",
            ),
        ],
    }
