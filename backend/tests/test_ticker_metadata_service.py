import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from app.services.ticker_metadata_service import (
    _map_yfinance_profile,
    _merge_stock_profiles,
    is_stale,
    metadata_to_dict,
    normalize_ticker,
)
from app.models.ticker_metadata import TickerMetadata


@pytest.mark.unit
def test_normalize_ticker():
    assert normalize_ticker("  aapl ") == "AAPL"
    assert normalize_ticker("btc-usd") == "BTC-USD"


@pytest.mark.unit
def test_is_stale():
    now = datetime(2026, 6, 3, 12, 0, tzinfo=timezone.utc)
    row = TickerMetadata(
        ticker="AAPL",
        asset_type="stock",
        source="finnhub",
        fetched_at=now,
        expires_at=now + timedelta(hours=1),
    )
    assert not is_stale(row, now)
    assert is_stale(row, now + timedelta(hours=2))


@pytest.mark.unit
def test_metadata_to_dict_includes_ipo_date():
    now = datetime(2026, 6, 3, 12, 0, tzinfo=timezone.utc)
    row = TickerMetadata(
        ticker="AAPL",
        asset_type="stock",
        company_name="Apple Inc.",
        source="finnhub",
        fetched_at=now,
        expires_at=now + timedelta(days=7),
        ipo_date=datetime(1980, 12, 12).date(),
    )
    d = metadata_to_dict(row)
    assert d["company_name"] == "Apple Inc."
    assert d["ipo_date"] == "1980-12-12"


@pytest.mark.unit
def test_map_yfinance_profile_converts_market_cap_to_millions():
    raw = {
        "longName": "Rheinmetall AG",
        "shortName": "Rheinmetall",
        "sector": "Industrials",
        "industry": "Aerospace & Defense",
        "website": "https://www.rheinmetall.com",
        "exchange": "GER",
        "country": "Germany",
        "currency": "EUR",
        "marketCap": 45_000_000_000,
    }
    mapped = _map_yfinance_profile(raw)
    assert mapped["company_name"] == "Rheinmetall AG"
    assert mapped["source"] == "yfinance"
    assert mapped["market_cap"] == 45_000


@pytest.mark.unit
def test_merge_stock_profiles_prefers_yfinance_with_finnhub_fallback():
    primary = {
        "asset_type": "stock",
        "company_name": "Rheinmetall AG",
        "display_name": "Rheinmetall",
        "sector": "Industrials",
        "industry": "Aerospace & Defense",
        "logo_url": None,
        "website": "https://www.rheinmetall.com",
        "exchange": "GER",
        "country": "Germany",
        "currency": "EUR",
        "market_cap": 45_000,
        "ipo_date": None,
        "source": "yfinance",
    }
    fallback = {
        "asset_type": "stock",
        "company_name": "Rheinmetall AG",
        "display_name": "Rheinmetall AG",
        "sector": "Capital Goods",
        "industry": "Capital Goods",
        "logo_url": "https://static.finnhub.io/logo/rhm.png",
        "website": "https://rheinmetall.com/",
        "exchange": "XETRA",
        "country": "DE",
        "currency": "EUR",
        "market_cap": 44_000,
        "ipo_date": None,
        "source": "finnhub",
    }
    merged = _merge_stock_profiles(primary, fallback)
    assert merged["company_name"] == "Rheinmetall AG"
    assert merged["sector"] == "Industrials"
    assert merged["logo_url"] == "https://static.finnhub.io/logo/rhm.png"
    assert merged["source"] == "yfinance+finnhub"


@pytest.mark.asyncio
async def test_refresh_stock_upserts_row():
    from app.database import AsyncSessionLocal
    from app.services import ticker_metadata_service

    yf_raw = {
        "longName": "Apple Inc.",
        "shortName": "Apple",
        "sector": "Technology",
        "industry": "Consumer Electronics",
    }
    fh_raw = {"name": "Apple Inc.", "finnhubIndustry": "Technology", "logo": "https://logo.test/aapl.png"}
    fh_mapped = {
        "asset_type": "stock",
        "company_name": "Apple Inc.",
        "display_name": "Apple Inc.",
        "sector": "Technology",
        "industry": "Technology",
        "logo_url": "https://logo.test/aapl.png",
        "source": "finnhub",
    }
    with (
        patch(
            "app.services.ticker_metadata_service._yf.fetch_company_profile",
            new=AsyncMock(return_value=yf_raw),
        ),
        patch(
            "app.services.ticker_metadata_service._fetch_stock_profile",
            new=AsyncMock(return_value=(fh_mapped, fh_raw, None)),
        ),
    ):
        async with AsyncSessionLocal() as db:
            row = await ticker_metadata_service.refresh_ticker_metadata(
                "ZZTEST", db, finnhub_key="fake-key"
            )
            assert row.ticker == "ZZTEST"
            assert row.company_name == "Apple Inc."
            assert row.sector == "Technology"
            assert row.industry == "Consumer Electronics"
            assert row.logo_url == "https://logo.test/aapl.png"
            assert row.source == "yfinance+finnhub"

        async with AsyncSessionLocal() as db:
            cached = await db.get(TickerMetadata, "ZZTEST")
            assert cached is not None
            assert cached.company_name == "Apple Inc."


@pytest.mark.asyncio
async def test_refresh_stock_yfinance_only_without_finnhub_key():
    from app.database import AsyncSessionLocal
    from app.services import ticker_metadata_service

    yf_raw = {
        "longName": "Rheinmetall AG",
        "shortName": "Rheinmetall",
        "sector": "Industrials",
        "website": "https://www.rheinmetall.com",
    }
    with patch(
        "app.services.ticker_metadata_service._yf.fetch_company_profile",
        new=AsyncMock(return_value=yf_raw),
    ):
        async with AsyncSessionLocal() as db:
            row = await ticker_metadata_service.refresh_ticker_metadata(
                "RHM.DE", db, finnhub_key=None
            )
            assert row.ticker == "RHM.DE"
            assert row.company_name == "Rheinmetall AG"
            assert row.source == "yfinance"
            assert row.website == "https://www.rheinmetall.com"
