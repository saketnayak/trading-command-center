"""Resolve listing / quote currency for a ticker (no FX conversion)."""

from __future__ import annotations

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.asset_type import is_crypto
from app.utils.quote_currency import quote_currency_from_ticker
from app.services.ticker_metadata_service import get_ticker_metadata
import app.services.yfinance_service as _yf


async def resolve_quote_currency(
    ticker: str,
    db: Optional[AsyncSession] = None,
    finnhub_key: Optional[str] = None,
) -> str:
    """Return the currency market prices for this ticker are denominated in."""
    normalized = ticker.strip().upper()

    if is_crypto(normalized):
        return quote_currency_from_ticker(normalized) or "USD"

    if db is not None:
        meta = await get_ticker_metadata(normalized, db, finnhub_key)
        if meta.currency:
            return meta.currency.upper()

    quote = await _yf.fetch_price_quote(normalized)
    if quote:
        return quote.currency_code

    return "USD"
