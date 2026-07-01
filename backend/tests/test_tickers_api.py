from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

from main import app
from app.models.api_key import ApiKey
from app.models.ticker_metadata import TickerMetadata
from app.models.user import User
from app.services.encryption import encrypt_key


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
async def test_ticker_snapshot_uses_yfinance_chart_without_finnhub_key():
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
                source="finnhub",
                fetched_at=now,
                expires_at=now + timedelta(days=7),
            )
        )
        await db.commit()

    fake_chart = {
        "t": [1_700_000_000, 1_700_086_400],
        "c": [400.0, 410.0],
        "h": [405.0, 415.0],
        "l": [395.0, 405.0],
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client, "snapshot_yf@test.com")
        with patch(
            "app.routers.ticker._yf_candles",
            new=AsyncMock(return_value=fake_chart),
        ):
            r = await client.get(
                "/ticker/MSFT/snapshot",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert r.status_code == 200
    data = r.json()
    assert data["chart"]["c"] == [400.0, 410.0]
    assert data["change_1d_pct"] == pytest.approx(2.5)


@pytest.mark.asyncio
async def test_ticker_snapshot_uses_configured_finnhub_key_even_if_flagged_invalid():
    from app.database import AsyncSessionLocal
    from sqlalchemy import select

    email = "snapshot_finnhub_flag@test.com"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client, email)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one()
        db.add(
            ApiKey(
                provider="finnhub",
                encrypted_key=encrypt_key("configured-finnhub"),
                is_valid=False,
                created_by=user.id,
            )
        )
        await db.commit()

    fake_chart = {
        "t": [1_700_000_000, 1_700_086_400],
        "c": [100.0, 101.0],
        "h": [102.0, 103.0],
        "l": [99.0, 100.0],
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch(
            "app.routers.ticker._stock_candles",
            new=AsyncMock(return_value=(fake_chart, None)),
        ) as mock_stock_candles:
            r = await client.get(
                "/ticker/MSFT/snapshot",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert r.status_code == 200
    assert r.json()["chart"]["c"] == [100.0, 101.0]
    mock_stock_candles.assert_awaited_once_with("MSFT", "configured-finnhub")


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


@pytest.mark.asyncio
async def test_get_ticker_logo_serves_cached_file(tmp_path):
    from app.database import AsyncSessionLocal

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        db.add(
            TickerMetadata(
                ticker="AAPL",
                asset_type="stock",
                company_name="Apple Inc.",
                display_name="Apple Inc.",
                logo_url="https://logo.example/aapl.png",
                source="finnhub",
                fetched_at=now,
                expires_at=now + timedelta(days=7),
            )
        )
        await db.commit()

    png_path = tmp_path / "AAPL.png"
    png_path.write_bytes(b"png-bytes")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client, "logo_route@test.com")
        with patch(
            "app.routers.tickers.logo_cache_service.ensure_logo_for_ticker",
            new=AsyncMock(return_value=(png_path, "image/png")),
        ):
            r = await client.get(
                "/tickers/AAPL/logo",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert r.status_code == 200
    assert r.content == b"png-bytes"
    assert "image/png" in r.headers.get("content-type", "")
    assert r.headers.get("cache-control") == "public, max-age=2592000, immutable"


@pytest.mark.asyncio
async def test_get_ticker_logo_uses_website_favicon_fallback(tmp_path):
    from app.database import AsyncSessionLocal

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        db.add(
            TickerMetadata(
                ticker="RHM.DE",
                asset_type="stock",
                company_name="Rheinmetall AG",
                display_name="Rheinmetall AG",
                website="https://www.rheinmetall.com",
                source="yfinance",
                fetched_at=now,
                expires_at=now + timedelta(days=7),
            )
        )
        await db.commit()

    png_path = tmp_path / "RHM.DE.png"
    png_path.write_bytes(b"png-bytes")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client, "logo_favicon@test.com")
        with patch(
            "app.routers.tickers.logo_cache_service.ensure_logo_for_ticker",
            new=AsyncMock(return_value=(png_path, "image/png")),
        ) as mock_logo:
            r = await client.get(
                "/tickers/RHM.DE/logo",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert r.status_code == 200
    mock_logo.assert_awaited_once()
    kwargs = mock_logo.await_args.kwargs
    assert kwargs["logo_url"] is None
    assert kwargs["website"] == "https://www.rheinmetall.com"

