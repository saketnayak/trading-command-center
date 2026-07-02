"""Batch ticker metadata (company name, sector, logo, etc.)."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.finnhub_client import get_finnhub_key
from app.services import logo_cache_service
from app.services.ticker_metadata_service import (
    get_many_ticker_metadata,
    get_ticker_metadata,
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
    return await get_finnhub_key(db)


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


_LOGO_CACHE_CONTROL = "public, max-age=2592000, immutable"


@router.get("/tickers/{symbol}/logo")
async def get_ticker_logo(
    symbol: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Serve a disk-cached company logo (30-day TTL). Uses Finnhub URL or website favicon fallback."""
    ticker = normalize_ticker(symbol)
    finnhub_key = await _get_finnhub_key(db)
    metadata = await get_ticker_metadata(ticker, db, finnhub_key)

    cached = await logo_cache_service.ensure_logo_for_ticker(
        ticker,
        logo_url=metadata.logo_url,
        website=metadata.website,
    )
    if cached is None:
        raise HTTPException(status_code=404, detail="Logo not available")

    path, content_type = cached
    return FileResponse(
        path,
        media_type=content_type,
        headers={"Cache-Control": _LOGO_CACHE_CONTROL},
    )
