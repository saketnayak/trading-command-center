"""
Per-ticker snapshot endpoint — powers the TickerDrawer in the portfolio UI.
Returns profile, 90-day candle chart, price-change %s, recent news, and
next earnings date for any ticker (stock or crypto).
"""
import asyncio
import html as _html
import re
import time
from datetime import date, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.api_key import ApiKey
from app.models.user import User
from app.services.encryption import decrypt_key
from app.services.ticker_metadata_service import get_ticker_metadata, normalize_ticker
from app.utils.asset_type import is_crypto
import app.services.crypto_data_service as _crypto

router = APIRouter()

_FH = "https://finnhub.io/api/v1"
_CG = "https://api.coingecko.com/api/v3"

_candle_cache: dict[str, tuple[dict, float]] = {}
_CANDLE_TTL  =  3_600   # 1 h


# ── Pydantic schema ───────────────────────────────────────────────────────────

class TickerSnapshotResponse(BaseModel):
    ticker: str
    asset_type: str            # "stock" | "crypto"
    name: Optional[str] = None
    description: Optional[str] = None
    sector: Optional[str] = None
    website: Optional[str] = None
    logo: Optional[str] = None
    exchange: Optional[str] = None
    country: Optional[str] = None
    change_1d_pct: Optional[float] = None
    change_1w_pct: Optional[float] = None
    change_1m_pct: Optional[float] = None
    fundamentals: dict = {}
    chart: dict = {}           # {t:[unix…], c:[close…], h:[high…], l:[low…]}
    news: list[dict] = []      # [{headline, url, datetime, source, image}]
    next_earnings: Optional[dict] = None   # {date, eps_estimate, eps_actual, hour}


# ── Shared helpers ────────────────────────────────────────────────────────────

async def _get_finnhub_key(db: AsyncSession) -> Optional[str]:
    result = await db.execute(select(ApiKey).where(ApiKey.provider == "finnhub"))
    row = result.scalar_one_or_none()
    return decrypt_key(row.encrypted_key) if row and row.is_valid else None


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    return _html.unescape(text).strip()


def _pct_from_candles(chart: dict) -> tuple[Optional[float], Optional[float], Optional[float]]:
    closes = chart.get("c", [])
    n = len(closes)
    if n < 2:
        return None, None, None
    last = closes[-1]
    def pct(prev: float) -> Optional[float]:
        return ((last - prev) / prev * 100) if prev else None
    return (
        pct(closes[-2])  if n >= 2  else None,
        pct(closes[-8])  if n >= 8  else None,
        pct(closes[-31]) if n >= 31 else None,
    )


# ── Stock helpers ─────────────────────────────────────────────────────────────

async def _stock_candles(ticker: str, api_key: str, days: int = 90) -> dict:
    now = time.time()
    key = f"{ticker}:{days}"
    if key in _candle_cache and now < _candle_cache[key][1]:
        return _candle_cache[key][0]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{_FH}/stock/candle",
                params={"symbol": ticker, "resolution": "D",
                        "from": int(now) - days * 86_400, "to": int(now),
                        "token": api_key},
            )
            r.raise_for_status()
            raw = r.json()
        data = (
            {"t": raw["t"], "c": raw["c"], "h": raw["h"], "l": raw["l"]}
            if raw.get("s") == "ok" else {}
        )
    except Exception:
        data = {}
    _candle_cache[key] = (data, now + _CANDLE_TTL)
    return data


async def _stock_fundamentals(ticker: str, api_key: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{_FH}/stock/metric",
                params={"symbol": ticker, "metric": "all", "token": api_key},
            )
            r.raise_for_status()
            m = r.json().get("metric", {})
        return {
            "pe_ratio":      m.get("peAnnual") or m.get("peTTM"),
            "beta":          m.get("beta"),
            "week52_high":   m.get("52WeekHigh"),
            "week52_low":    m.get("52WeekLow"),
            "dividend_yield":m.get("dividendYieldIndicatedAnnual"),
            "eps_ttm":       m.get("epsBasicExclExtraItemsTTM"),
            "market_cap":    m.get("marketCapitalization"),  # millions
        }
    except Exception:
        return {}


async def _stock_news(ticker: str, api_key: str) -> list[dict]:
    today = date.today()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{_FH}/company-news",
                params={"symbol": ticker, "from": today - timedelta(days=14),
                        "to": today, "token": api_key},
            )
            r.raise_for_status()
            raw = r.json()
        return [
            {"headline": a["headline"], "url": a.get("url", ""),
             "datetime": a.get("datetime"), "source": a.get("source", ""),
             "image": a.get("image", "")}
            for a in (raw if isinstance(raw, list) else [])
            if a.get("headline")
        ][:5]
    except Exception:
        return []


async def _next_earnings(ticker: str, api_key: str) -> Optional[dict]:
    today = date.today()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{_FH}/calendar/earnings",
                params={"from": today, "to": today + timedelta(days=90),
                        "symbol": ticker, "token": api_key},
            )
            r.raise_for_status()
            events = r.json().get("earningsCalendar", [])
        if events:
            e = events[0]
            return {"date": e.get("date"), "eps_estimate": e.get("epsEstimate"),
                    "eps_actual": e.get("epsActual"), "hour": e.get("hour")}
    except Exception:
        pass
    return None


# ── Crypto helpers ────────────────────────────────────────────────────────────

async def _crypto_candles(ticker: str, days: int = 90) -> dict:
    symbol = _crypto.extract_symbol(ticker)
    cg_id = await _crypto.coingecko_id(symbol)
    if not cg_id:
        return {}
    now = time.time()
    key = f"{ticker}:{days}"
    if key in _candle_cache and now < _candle_cache[key][1]:
        return _candle_cache[key][0]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{_CG}/coins/{cg_id}/market_chart",
                params={"vs_currency": "usd", "days": days, "interval": "daily"},
            )
            r.raise_for_status()
            raw = r.json()
        prices = raw.get("prices", [])
        data = {"t": [int(p[0] / 1000) for p in prices], "c": [p[1] for p in prices]}
    except Exception:
        data = {}
    _candle_cache[key] = (data, now + _CANDLE_TTL)
    return data


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/ticker/{ticker}/snapshot", response_model=TickerSnapshotResponse)
async def get_ticker_snapshot(
    ticker: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ticker = normalize_ticker(ticker)
    api_key = await _get_finnhub_key(db)
    metadata = await get_ticker_metadata(ticker, db, api_key)

    # ── Crypto ────────────────────────────────────────────────────────────────
    if is_crypto(ticker):
        metrics, chart = await asyncio.gather(
            _crypto.fetch_metrics(ticker),
            _crypto_candles(ticker),
        )
        name = metrics.pop("name", _crypto.extract_symbol(ticker))
        description = metrics.pop("description", None)
        d1 = metrics.get("price_change_24h_pct")
        d7 = metrics.get("price_change_7d_pct")
        _, _, d30 = _pct_from_candles(chart)
        return TickerSnapshotResponse(
            ticker=ticker, asset_type="crypto",
            name=metadata.company_name or metadata.display_name or name,
            description=description,
            sector=metadata.sector or metrics.get("category"),
            website=metadata.website,
            logo=metadata.logo_url,
            exchange=metadata.exchange,
            country=metadata.country,
            change_1d_pct=d1, change_1w_pct=d7, change_1m_pct=d30,
            fundamentals=metrics, chart=chart,
        )

    # ── Stock ─────────────────────────────────────────────────────────────────
    if not api_key:
        return TickerSnapshotResponse(
            ticker=ticker,
            asset_type="stock",
            name=metadata.company_name or metadata.display_name,
            sector=metadata.sector,
            website=metadata.website,
            logo=metadata.logo_url,
            exchange=metadata.exchange,
            country=metadata.country,
        )

    chart, fundamentals, news, next_e = await asyncio.gather(
        _stock_candles(ticker, api_key),
        _stock_fundamentals(ticker, api_key),
        _stock_news(ticker, api_key),
        _next_earnings(ticker, api_key),
    )
    d1, d7, d30 = _pct_from_candles(chart)
    return TickerSnapshotResponse(
        ticker=ticker, asset_type="stock",
        name=metadata.company_name or metadata.display_name,
        sector=metadata.sector,
        website=metadata.website,
        logo=metadata.logo_url,
        exchange=metadata.exchange,
        country=metadata.country,
        change_1d_pct=d1, change_1w_pct=d7, change_1m_pct=d30,
        fundamentals=fundamentals, chart=chart,
        news=news, next_earnings=next_e,
    )
