from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

from main import app
from app.models.ticker_metadata import TickerMetadata


async def _token(client: AsyncClient, email: str = "meta@test.com") -> str:
    await client.post(
        "/auth/register",
        json={"email": email, "password": "password1", "name": "Meta"},
    )
    r = await client.post("/auth/login", json={"email": email, "password": "password1"})
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_get_tickers_metadata_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/tickers/metadata", params={"symbols": "AAPL"})
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_tickers_metadata_cache_hit():
    from app.database import AsyncSessionLocal

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        db.add(
            TickerMetadata(
                ticker="AAPL",
                asset_type="stock",
                company_name="Apple Inc.",
                display_name="Apple Inc.",
                sector="Technology",
                source="finnhub",
                fetched_at=now,
                expires_at=now + timedelta(days=7),
            )
        )
        await db.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client, "meta_hit@test.com")
        with patch(
            "app.services.ticker_metadata_service.refresh_ticker_metadata",
            new=AsyncMock(),
        ) as mock_refresh:
            r = await client.get(
                "/tickers/metadata",
                params={"symbols": "AAPL"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert r.status_code == 200
            data = r.json()
            assert data["items"]["AAPL"]["company_name"] == "Apple Inc."
            mock_refresh.assert_not_called()


@pytest.mark.asyncio
async def test_ticker_snapshot_uses_cached_metadata_without_finnhub_key():
    from app.database import AsyncSessionLocal

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        db.add(
            TickerMetadata(
                ticker="MSFT",
                asset_type="stock",
                company_name="Microsoft Corporation",
                display_name="Microsoft Corporation",
                sector="Technology",
                logo_url="https://logo.example/msft.png",
                website="https://www.microsoft.com",
                exchange="NASDAQ",
                country="US",
                source="finnhub",
                fetched_at=now,
                expires_at=now + timedelta(days=7),
            )
        )
        await db.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client, "snapshot_meta@test.com")
        r = await client.get(
            "/ticker/MSFT/snapshot",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert r.status_code == 200
    data = r.json()
    assert data["ticker"] == "MSFT"
    assert data["name"] == "Microsoft Corporation"
    assert data["sector"] == "Technology"
    assert data["logo"] == "https://logo.example/msft.png"
    assert data["website"] == "https://www.microsoft.com"
