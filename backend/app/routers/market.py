"""
Market-wide data endpoints — trending tickers, top movers, sector performance.
Uses Yahoo Finance for trending/quote fallback, Finnhub quotes when available,
and cached ticker metadata.
"""
import asyncio
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.api_key import ApiKey
from app.models.ticker_metadata import TickerMetadata
from app.models.user import User
from app.services.encryption import decrypt_key
from app.services.ticker_metadata_service import get_many_ticker_metadata
import app.services.yfinance_service as _yf

router = APIRouter()

_FH = "https://finnhub.io/api/v1"
_MARKET_TTL = 1800   # 30 min — quote cache

# Limit concurrent outgoing Finnhub requests to avoid bursting the free-tier
# rate limit (60 req/min). Semaphore(10) keeps peak concurrency well below
# that while still parallelising effectively.
_FINNHUB_SEM = asyncio.Semaphore(10)

# Curated universe of ~55 well-known US stocks used to compute top movers.
MARKET_UNIVERSE = [
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "AVGO", "ORCL", "AMD",
    # Finance
    "JPM", "BAC", "GS", "MS", "V", "MA", "AXP", "BLK", "WFC", "C",
    # Healthcare
    "UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ABT",
    # Energy
    "XOM", "CVX", "COP", "SLB", "EOG",
    # Consumer
    "WMT", "COST", "HD", "MCD", "NKE", "SBUX", "TGT",
    # Industrial
    "GE", "CAT", "BA", "UPS", "HON", "RTX",
    # Communication / media
    "DIS", "NFLX", "T", "VZ", "CMCSA",
    # Other blue chips
    "BRK-B", "PG", "KO", "PEP",
]

# SPDR sector ETFs — one per GICS sector.
SECTOR_ETFS: list[tuple[str, str]] = [
    ("Technology", "XLK"),
    ("Financials", "XLF"),
    ("Healthcare", "XLV"),
    ("Energy", "XLE"),
    ("Industrials", "XLI"),
    ("Materials", "XLB"),
    ("Real Estate", "XLRE"),
    ("Consumer Staples", "XLP"),
    ("Consumer Discretionary", "XLY"),
    ("Utilities", "XLU"),
    ("Communication", "XLC"),
]

# In-process caches
_quote_cache: dict[str, tuple[dict, float]] = {}
_trending_cache: tuple[list[str], float] = ([], 0.0)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class MarketTicker(BaseModel):
    ticker: str
    name: Optional[str] = None
    sector: Optional[str] = None
    logo: Optional[str] = None
    price: Optional[float] = None
    change_pct: Optional[float] = None
    change: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    prev_close: Optional[float] = None
    market_cap: Optional[float] = None


class MoversResponse(BaseModel):
    gainers: list[MarketTicker]
    losers: list[MarketTicker]


class SectorData(BaseModel):
    sector: str
    ticker: str
    price: Optional[float] = None
    change_pct: Optional[float] = None


# ── Shared helpers ────────────────────────────────────────────────────────────

async def _get_finnhub_key(db: AsyncSession) -> Optional[str]:
    result = await db.execute(select(ApiKey).where(ApiKey.provider == "finnhub"))
    row = result.scalar_one_or_none()
    return decrypt_key(row.encrypted_key) if row else None


async def _fetch_quote(
    ticker: str,
    api_key: Optional[str],
    client: httpx.AsyncClient,
) -> Optional[dict]:
    now = time.time()
    if ticker in _quote_cache:
        data, expiry = _quote_cache[ticker]
        if now < expiry:
            return data
    data = None
    if api_key:
        async with _FINNHUB_SEM:
            try:
                r = await client.get(f"{_FH}/quote", params={"symbol": ticker, "token": api_key})
                r.raise_for_status()
                raw = r.json()
                c = raw.get("c") or 0
                pc = raw.get("pc") or 0
                price = float(c) if c else (float(pc) if pc else None)
                if price is not None:
                    data = {
                        "price": price,
                        "change_pct": raw.get("dp"),
                        "change": raw.get("d"),
                        "high": raw.get("h"),
                        "low": raw.get("l"),
                        "prev_close": float(pc) if pc else None,
                    }
            except Exception:
                data = None
    if data is None:
        data = await _yf.fetch_quote(ticker)
    if data is None:
        return None
    _quote_cache[ticker] = (data, now + _MARKET_TTL)
    return data


async def _get_trending_tickers(client: httpx.AsyncClient) -> list[str]:
    """Fetch trending US tickers from Yahoo Finance. Falls back to a curated list on error."""
    global _trending_cache
    tickers, expiry = _trending_cache
    if time.time() < expiry:
        return tickers
    try:
        r = await client.get(
            "https://query1.finance.yahoo.com/v1/finance/trending/US",
            params={"count": 25},
        )
        r.raise_for_status()
        raw = r.json()
        quotes = raw.get("finance", {}).get("result", [{}])[0].get("quotes", [])
        # Keep only plain US equity symbols (exclude futures =F, forex =X, and dot-suffixed non-US)
        tickers = [
            q["symbol"]
            for q in quotes
            if q.get("symbol")
            and "." not in q["symbol"]
            and "=F" not in q["symbol"]
            and "=X" not in q["symbol"]
        ][:20]
    except Exception:
        tickers = ["AAPL", "NVDA", "TSLA", "META", "AMZN", "MSFT", "GOOGL", "AMD", "NFLX", "V"]
    _trending_cache = (tickers, time.time() + _MARKET_TTL)
    return tickers


def _build_ticker(ticker: str, quote: dict, metadata: TickerMetadata | None) -> MarketTicker:
    return MarketTicker(
        ticker=ticker,
        name=metadata.company_name if metadata else None,
        sector=metadata.sector if metadata else None,
        logo=metadata.logo_url if metadata else None,
        market_cap=metadata.market_cap if metadata else None,
        price=quote.get("price"),
        change_pct=quote.get("change_pct"),
        change=quote.get("change"),
        high=quote.get("high"),
        low=quote.get("low"),
        prev_close=quote.get("prev_close"),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/market/trending", response_model=list[MarketTicker])
async def get_trending(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return current trending US tickers from Yahoo Finance, enriched with Finnhub data."""
    api_key = await _get_finnhub_key(db)
    async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "Mozilla/5.0"}) as client:
        tickers = await _get_trending_tickers(client)
        if not tickers:
            return []
        quotes_list = await asyncio.gather(*[_fetch_quote(t, api_key, client) for t in tickers])
    metadata = await get_many_ticker_metadata(tickers, db, api_key)
    return [
        _build_ticker(t, q, metadata.get(t))
        for t, q in zip(tickers, quotes_list)
        if q is not None
    ]


@router.get("/market/movers", response_model=MoversResponse)
async def get_movers(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return top 5 gainers and top 5 losers from the curated MARKET_UNIVERSE."""
    api_key = await _get_finnhub_key(db)

    async with httpx.AsyncClient(timeout=8) as client:
        quotes_list = await asyncio.gather(
            *[_fetch_quote(t, api_key, client) for t in MARKET_UNIVERSE]
        )
        ranked = [
            {"ticker": t, **q}
            for t, q in zip(MARKET_UNIVERSE, quotes_list)
            if q and q.get("change_pct") is not None
        ]
        ranked.sort(key=lambda x: x["change_pct"])  # ascending: losers first

        losers_raw = ranked[:5]
        gainers_raw = list(reversed(ranked[-5:]))

    mover_tickers = [x["ticker"] for x in gainers_raw + losers_raw]
    metadata = await get_many_ticker_metadata(mover_tickers, db, api_key)
    gainers = [_build_ticker(x["ticker"], x, metadata.get(x["ticker"])) for x in gainers_raw]
    losers = [_build_ticker(x["ticker"], x, metadata.get(x["ticker"])) for x in losers_raw]

    return MoversResponse(gainers=gainers, losers=losers)


@router.get("/market/sectors", response_model=list[SectorData])
async def get_sectors(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return daily % change for all 11 SPDR sector ETFs."""
    api_key = await _get_finnhub_key(db)
    etf_tickers = [ticker for _, ticker in SECTOR_ETFS]
    async with httpx.AsyncClient(timeout=8) as client:
        quotes_list = await asyncio.gather(
            *[_fetch_quote(t, api_key, client) for t in etf_tickers]
        )
    return [
        SectorData(
            sector=sector,
            ticker=ticker,
            price=q.get("price") if q else None,
            change_pct=q.get("change_pct") if q else None,
        )
        for (sector, ticker), q in zip(SECTOR_ETFS, quotes_list)
    ]
