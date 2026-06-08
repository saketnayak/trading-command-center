import os

import pytest

pytestmark = pytest.mark.unit

from app.services.trading_agent_runner import _extract_prices


def test_extract_prices_full_match():
    text = (
        "Recommendation: Entry: $150.00, Stop Loss: $140.00, Target: $175.00. "
        "This is a strong buy signal."
    )
    entry, stop, target = _extract_prices(text)
    assert entry == "150.00"
    assert stop == "140.00"
    assert target == "175.00"


def test_extract_prices_partial_match():
    text = "Buy AAPL. Entry: $150. No stop defined. No target given."
    entry, stop, target = _extract_prices(text)
    assert entry == "150"
    assert stop is None
    assert target is None


def test_extract_prices_no_match():
    text = "This stock looks attractive based on fundamentals."
    entry, stop, target = _extract_prices(text)
    assert entry is None
    assert stop is None
    assert target is None


def test_extract_prices_case_insensitive():
    text = "ENTRY: $200. STOP LOSS: $185. TAKE PROFIT: $230."
    entry, stop, target = _extract_prices(text)
    assert entry == "200"
    assert stop == "185"
    assert target == "230"


def test_extract_prices_alternative_phrasings():
    text = "Buy at: $95.50. Stop at: $88.00. Price target: $110.00."
    entry, stop, target = _extract_prices(text)
    assert entry == "95.50"
    assert stop == "88.00"
    assert target == "110.00"


def test_extract_prices_comma_formatted():
    text = "Entry Price: $1,500.00. Stop Loss: $1,400.00. Profit Target: $1,750.00."
    entry, stop, target = _extract_prices(text)
    assert entry == "1,500.00"
    assert stop == "1,400.00"
    assert target == "1,750.00"


def test_groq_reasoning_effort_skipped():
    """_apply_reasoning must not set reasoning_effort when OPENAI_BASE_URL is Groq."""
    from tradingagents.llm import _apply_reasoning

    old = os.environ.get("OPENAI_BASE_URL")
    try:
        os.environ["OPENAI_BASE_URL"] = "https://api.groq.com/openai/v1"
        kwargs: dict = {}
        _apply_reasoning("openai", "medium", kwargs)
        assert "reasoning_effort" not in kwargs
    finally:
        if old is None:
            os.environ.pop("OPENAI_BASE_URL", None)
        else:
            os.environ["OPENAI_BASE_URL"] = old


def test_openai_reasoning_effort_applied_without_base_url():
    """_apply_reasoning must still set reasoning_effort for native OpenAI (no base URL override)."""
    from tradingagents.llm import _apply_reasoning

    old = os.environ.get("OPENAI_BASE_URL")
    try:
        os.environ.pop("OPENAI_BASE_URL", None)
        kwargs: dict = {}
        _apply_reasoning("openai", "medium", kwargs)
        assert kwargs.get("reasoning_effort") == "medium"
    finally:
        if old is None:
            os.environ.pop("OPENAI_BASE_URL", None)
        else:
            os.environ["OPENAI_BASE_URL"] = old


def test_openai_reasoning_effort_max_maps_to_xhigh():
    """_apply_reasoning must map 'max' -> 'xhigh' for native OpenAI."""
    from tradingagents.llm import _apply_reasoning

    old = os.environ.get("OPENAI_BASE_URL")
    try:
        os.environ.pop("OPENAI_BASE_URL", None)
        kwargs: dict = {}
        _apply_reasoning("openai", "max", kwargs)
        assert kwargs.get("reasoning_effort") == "xhigh"
    finally:
        if old is None:
            os.environ.pop("OPENAI_BASE_URL", None)
        else:
            os.environ["OPENAI_BASE_URL"] = old
