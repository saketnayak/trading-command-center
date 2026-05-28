from types import SimpleNamespace

import pytest

from app.services.trading_agent_runner import (
    _extract_trader_decision,
    _normalize_price,
    _parse_verdict,
)
from app.models.run import RunVerdict

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize(
    ("signal", "expected"),
    [
        ("BUY", RunVerdict.buy),
        ("buy", RunVerdict.buy),
        ("SELL", RunVerdict.sell),
        ("sell", RunVerdict.sell),
        ("HOLD", RunVerdict.hold),
        ("", RunVerdict.hold),
    ],
)
async def test_parse_verdict(signal, expected):
    rec = SimpleNamespace(signal=signal)
    assert _parse_verdict(rec) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (150.5, "150.5"),
        ("$142.00", "$142.00"),
        (None, None),
        ("n/a", None),
    ],
)
async def test_normalize_price(value, expected):
    assert _normalize_price(value) == expected


async def test_extract_trader_decision_prefers_recommendation_rationale():
    state = SimpleNamespace(final_trade_decision="legacy text")
    rec = SimpleNamespace(rationale="Structured rationale from Risk Judge.")
    assert _extract_trader_decision(state, rec) == "Structured rationale from Risk Judge."


async def test_extract_trader_decision_falls_back_to_state():
    state = SimpleNamespace(
        final_trade_recommendation=None,
        final_trade_decision="FINAL TRANSACTION PROPOSAL: **BUY**",
    )
    rec = SimpleNamespace(rationale="")
    assert "BUY" in _extract_trader_decision(state, rec)
