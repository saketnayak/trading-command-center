"""Batch ticker metadata (company name, sector, logo, etc.)."""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.api_key import ApiKey
from app.models.user import User
from app.services.encryption import decrypt_key
from app.services.ticker_metadata_service import (
    get_many_ticker_metadata,
    metadata_to_dict,
    normalize_ticker,
)

router = APIRouter()

_MAX_SYMBOLS = 50


class TickerMetadataItem(BaseModel):
    ticker: str
    asset_type: str
    company_name: Optional[str] = None
    display_name: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    logo_url: Optional[str] = None
    website: Optional[str] = None
    exchange: Optional[str] = None
    country: Optional[str] = None
    currency: Optional[str] = None
    market_cap: Optional[float] = None
    ipo_date: Optional[str] = None
    source: str
    fetched_at: str
    expires_at: str


class TickerMetadataResponse(BaseModel):
    items: dict[str, TickerMetadataItem]


async def _get_finnhub_key(db: AsyncSession) -> Optional[str]:
    result = await db.execute(select(ApiKey).where(ApiKey.provider == "finnhub"))
    row = result.scalar_one_or_none()
    return decrypt_key(row.encrypted_key) if row and row.is_valid else None


@router.get("/tickers/metadata", response_model=TickerMetadataResponse)
async def get_ticker_metadata_batch(
    symbols: str = Query(..., description="Comma-separated tickers, e.g. AAPL,MSFT"),
    force_refresh: bool = False,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> TickerMetadataResponse:
    tickers = []
    for part in symbols.split(","):
        part = part.strip()
        if part:
            tickers.append(normalize_ticker(part))
        if len(tickers) >= _MAX_SYMBOLS:
            break

    finnhub_key = await _get_finnhub_key(db)
    rows = await get_many_ticker_metadata(
        tickers, db, finnhub_key, force_refresh=force_refresh
    )
    items = {
        t: TickerMetadataItem(**metadata_to_dict(rows[t]))
        for t in tickers
        if t in rows
    }
    return TickerMetadataResponse(items=items)
