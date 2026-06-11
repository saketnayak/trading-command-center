from unittest.mock import AsyncMock

import httpx
import pytest

from app.routers import market


pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_market_quote_falls_back_to_yfinance_when_finnhub_fails(httpx_mock, monkeypatch):
    market._quote_cache.clear()
    httpx_mock.add_response(
        status_code=403,
        json={"error": "You don't have access to this resource."},
    )
    fallback_quote = {
        "price": 199.5,
        "change_pct": 1.5,
        "change": 2.95,
        "high": 201.0,
        "low": 196.0,
        "prev_close": 196.55,
    }
    fallback = AsyncMock(return_value=fallback_quote)
    monkeypatch.setattr(market._yf, "fetch_quote", fallback)

    async with httpx.AsyncClient() as client:
        quote = await market._fetch_quote("AAPL", "blocked-finnhub", client)

    assert quote == fallback_quote
    fallback.assert_awaited_once_with("AAPL")
