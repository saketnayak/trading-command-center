import pytest

from app.utils.tradingagents_analysts import DEFAULT_ANALYSTS, normalize_analysts

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_normalize_defaults():
    assert normalize_analysts(None) == DEFAULT_ANALYSTS


async def test_normalize_drops_technical_and_dedupes():
    assert normalize_analysts(["market", "technical", "market", "news"]) == [
        "market",
        "news",
    ]


async def test_normalize_maps_technical_to_market():
    assert normalize_analysts(["technical", "social"]) == ["market", "social"]


async def test_normalize_ignores_unknown():
    assert normalize_analysts(["market", "bogus", "news"]) == ["market", "news"]


async def test_normalize_excludes_fundamentals_for_crypto():
    assert normalize_analysts(
        ["market", "fundamentals", "news"],
        exclude_fundamentals=True,
    ) == ["market", "news"]


async def test_normalize_empty_after_filter_uses_fallback():
    assert normalize_analysts(
        ["fundamentals"],
        exclude_fundamentals=True,
    ) == ["market", "social", "news"]
