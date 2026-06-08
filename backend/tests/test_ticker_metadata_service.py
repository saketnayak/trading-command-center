import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from app.services.ticker_metadata_service import (
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


@pytest.mark.asyncio
async def test_refresh_stock_upserts_row():
    from app.database import AsyncSessionLocal
    from app.services import ticker_metadata_service

    raw = {"name": "Apple Inc.", "finnhubIndustry": "Technology"}
    mapped = {
        "asset_type": "stock",
        "company_name": "Apple Inc.",
        "display_name": "Apple Inc.",
        "sector": "Technology",
        "industry": "Technology",
        "source": "finnhub",
    }
    with patch(
        "app.services.ticker_metadata_service._fetch_stock_profile",
        new=AsyncMock(return_value=(mapped, raw)),
    ):
        async with AsyncSessionLocal() as db:
            row = await ticker_metadata_service.refresh_ticker_metadata(
                "ZZTEST", db, finnhub_key="fake-key"
            )
            assert row.ticker == "ZZTEST"
            assert row.company_name == "Apple Inc."

        async with AsyncSessionLocal() as db:
            cached = await db.get(TickerMetadata, "ZZTEST")
            assert cached is not None
            assert cached.company_name == "Apple Inc."
