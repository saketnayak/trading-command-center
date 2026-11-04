"""Shared helpers for the price-history based portfolio endpoints
(performance and risk): holdings aggregation and FX factors."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ticker_metadata import TickerMetadata
from app.services import fx_service
from app.utils.quote_currency import quote_currency_from_ticker


def aggregate_shares(holdings) -> dict[str, float]:
    """Sum shares per upper-cased ticker, dropping zero and negative rows."""
    shares: dict[str, float] = {}
    for h in holdings:
        sym = h.ticker.strip().upper()
        shares[sym] = shares.get(sym, 0.0) + float(h.shares or 0.0)
    return {s: q for s, q in shares.items() if q > 0}


async def fx_factors(
    db: AsyncSession, symbols: list[str], display_currency: str
) -> tuple[dict[str, float], dict[str, str]]:
    """symbol → factor from its listing currency into the display currency
    (today's rate), plus each symbol's listing currency."""
    meta = {
        row.ticker.upper(): (row.currency or "").upper()
        for row in (await db.execute(select(TickerMetadata).where(TickerMetadata.ticker.in_(symbols)))).scalars()
    }
    target = await fx_service.get_rate(display_currency)
    factors: dict[str, float] = {}
    currencies: dict[str, str] = {}
    for sym in symbols:
        ccy = quote_currency_from_ticker(sym) or meta.get(sym) or "USD"
        currencies[sym] = ccy
        local = await fx_service.get_rate(ccy) if ccy in fx_service.SUPPORTED_CURRENCIES else 1.0
        factors[sym] = target / local if local else 1.0
    return factors, currencies
