from datetime import date
from unittest.mock import AsyncMock

import pytest

from app.services import outcome_service


pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_stock_outcome_price_falls_back_to_yfinance_when_finnhub_fails(httpx_mock, monkeypatch):
    httpx_mock.add_response(
        status_code=403,
        json={"error": "You don't have access to this resource."},
    )
    fallback = AsyncMock(return_value=101.25)
    monkeypatch.setattr(outcome_service._yf, "fetch_historical_close", fallback)

    price = await outcome_service._fetch_closing_price(
        "AAPL",
        date(2024, 1, 10),
        "blocked-finnhub",
    )

    assert price == pytest.approx(101.25)
    fallback.assert_awaited_once_with("AAPL", date(2024, 1, 10))
