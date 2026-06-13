import pytest
from unittest.mock import AsyncMock, patch

from app.services.finnhub_client import FinnhubCapability, FinnhubError, FinnhubReason


@pytest.mark.asyncio
async def test_fetch_news_returns_premium_required_reason():
    from app.routers import portfolio as portfolio_router

    portfolio_router._news_cache.clear()
    premium_error = FinnhubError(
        capability=FinnhubCapability.COMPANY_NEWS,
        reason=FinnhubReason.PREMIUM_REQUIRED,
        message="premium required",
    )

    with patch(
        "app.routers.portfolio.fetch_json",
        new=AsyncMock(return_value=([], premium_error)),
    ):
        articles, error = await portfolio_router._fetch_news("AAPL", "test-key", 7)

    assert articles == []
    assert error is not None
    assert error.reason == FinnhubReason.PREMIUM_REQUIRED
    assert "AAPL:7" not in portfolio_router._news_cache


@pytest.mark.asyncio
async def test_get_portfolio_news_surfaces_unavailable_reason(monkeypatch):
    premium_error = FinnhubError(
        capability=FinnhubCapability.COMPANY_NEWS,
        reason=FinnhubReason.PREMIUM_REQUIRED,
        message="premium required",
    )

    async def fake_fetch_news(ticker, api_key, days):
        return [], premium_error

    from app.routers import portfolio as portfolio_router

    monkeypatch.setattr(portfolio_router, "_fetch_news", fake_fetch_news)
    monkeypatch.setattr(portfolio_router, "_get_finnhub_key", AsyncMock(return_value="test-key"))
    monkeypatch.setattr(portfolio_router, "_verify_portfolio_access", AsyncMock())

    class FakeHolding:
        ticker = "AAPL"

    class FakeSnapshot:
        holdings = [FakeHolding()]

    class FakeResult:
        def scalar_one_or_none(self):
            return FakeSnapshot()

    class FakeDb:
        async def execute(self, *_args, **_kwargs):
            return FakeResult()

    class FakeUser:
        id = "00000000-0000-0000-0000-000000000099"

    response = await portfolio_router.get_portfolio_news(
        portfolio_id="00000000-0000-0000-0000-000000000001",
        days=7,
        limit=40,
        db=FakeDb(),
        user=FakeUser(),
    )

    assert response["articles"] == []
    assert response["news_unavailable_reason"] == FinnhubReason.PREMIUM_REQUIRED.value


@pytest.mark.asyncio
async def test_fetch_fundamentals_returns_premium_required_reason():
    from app.routers import portfolio as portfolio_router

    portfolio_router._fundamentals_cache.clear()
    premium_error = FinnhubError(
        capability=FinnhubCapability.STOCK_METRIC,
        reason=FinnhubReason.PREMIUM_REQUIRED,
        message="premium required",
    )

    with patch(
        "app.routers.portfolio.fetch_json",
        new=AsyncMock(return_value=({}, premium_error)),
    ):
        fundamentals, error = await portfolio_router._fetch_fundamentals("AAPL", "test-key")

    assert fundamentals == {"asset_type": "stock"}
    assert error is not None
    assert error.reason == FinnhubReason.PREMIUM_REQUIRED
    assert "AAPL" not in portfolio_router._fundamentals_cache


@pytest.mark.asyncio
async def test_get_portfolio_fundamentals_surfaces_unavailable_reason(monkeypatch):
    premium_error = FinnhubError(
        capability=FinnhubCapability.STOCK_METRIC,
        reason=FinnhubReason.PREMIUM_REQUIRED,
        message="premium required",
    )

    async def fake_fetch_fundamentals(ticker, api_key):
        return {"asset_type": "stock"}, premium_error

    from app.routers import portfolio as portfolio_router

    monkeypatch.setattr(portfolio_router, "_fetch_fundamentals", fake_fetch_fundamentals)
    monkeypatch.setattr(portfolio_router, "_get_finnhub_key", AsyncMock(return_value="test-key"))
    monkeypatch.setattr(portfolio_router, "_verify_portfolio_access", AsyncMock())

    class FakeHolding:
        ticker = "AAPL"

    class FakeSnapshot:
        holdings = [FakeHolding()]

    class FakeResult:
        def scalar_one_or_none(self):
            return FakeSnapshot()

    class FakeDb:
        async def execute(self, *_args, **_kwargs):
            return FakeResult()

    class FakeUser:
        id = "00000000-0000-0000-0000-000000000099"

    response = await portfolio_router.get_portfolio_fundamentals(
        portfolio_id="00000000-0000-0000-0000-000000000001",
        db=FakeDb(),
        user=FakeUser(),
    )

    assert response["data"] == {"AAPL": {"asset_type": "stock"}}
    assert response["fundamentals_unavailable_reason"] == FinnhubReason.PREMIUM_REQUIRED.value
