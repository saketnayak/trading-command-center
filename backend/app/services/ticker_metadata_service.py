"""Unified ticker profile metadata — DB-backed cache with provider refresh."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ticker_metadata import TickerMetadata
from app.utils.asset_type import is_crypto
import app.services.crypto_data_service as _crypto
from app.services.finnhub_client import (
    FinnhubCapability,
    FinnhubError,
    fetch_json,
)
import app.services.yfinance_service as _yf

logger = logging.getLogger(__name__)

_METADATA_TTL = timedelta(days=7)
_FAILURE_TTL = timedelta(minutes=15)
def normalize_ticker(ticker: str) -> str:
    return ticker.strip().upper()


def is_stale(row: TickerMetadata, now: Optional[datetime] = None) -> bool:
    now = now or datetime.now(timezone.utc)
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return now >= expires


def metadata_to_dict(row: TickerMetadata) -> dict[str, Any]:
    return {
        "ticker": row.ticker,
        "asset_type": row.asset_type,
        "company_name": row.company_name,
        "display_name": row.display_name,
        "sector": row.sector,
        "industry": row.industry,
        "logo_url": row.logo_url,
        "website": row.website,
        "exchange": row.exchange,
        "country": row.country,
        "currency": row.currency,
        "market_cap": row.market_cap,
        "ipo_date": row.ipo_date.isoformat() if row.ipo_date else None,
        "source": row.source,
        "fetched_at": row.fetched_at.isoformat(),
        "expires_at": row.expires_at.isoformat(),
    }


def _parse_ipo_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _market_cap_from_finnhub(raw: dict) -> float | None:
    cap = raw.get("marketCapitalization")
    if cap is None:
        return None
    try:
        return float(cap)
    except (TypeError, ValueError):
        return None


def _market_cap_from_yfinance(raw: dict) -> float | None:
    """Convert yfinance absolute marketCap to Finnhub-style millions."""
    cap = raw.get("marketCap")
    if cap is None:
        return None
    try:
        return float(cap) / 1_000_000
    except (TypeError, ValueError):
        return None


def _map_yfinance_profile(raw: dict) -> dict[str, Any]:
    name = raw.get("longName") or raw.get("shortName")
    if not name or not str(name).strip():
        return {}
    short_name = raw.get("shortName")
    display = str(short_name).strip() if short_name else str(name).strip()
    return {
        "asset_type": "stock",
        "company_name": str(name).strip(),
        "display_name": display,
        "sector": raw.get("sector"),
        "industry": raw.get("industry"),
        "logo_url": None,
        "website": raw.get("website"),
        "exchange": raw.get("exchange"),
        "country": raw.get("country"),
        "currency": raw.get("currency"),
        "market_cap": _market_cap_from_yfinance(raw),
        "ipo_date": None,
        "source": "yfinance",
    }


def _merge_stock_profiles(
    primary: dict[str, Any],
    fallback: dict[str, Any],
) -> dict[str, Any]:
    """Merge profiles with yfinance (primary) fields winning over Finnhub (fallback)."""
    merged = dict(primary)
    for key in (
        "company_name",
        "display_name",
        "sector",
        "industry",
        "website",
        "exchange",
        "country",
        "currency",
        "logo_url",
    ):
        primary_val = primary.get(key)
        if primary_val is None or primary_val == "":
            fallback_val = fallback.get(key)
            if fallback_val is not None and fallback_val != "":
                merged[key] = fallback_val
    if merged.get("market_cap") is None and fallback.get("market_cap") is not None:
        merged["market_cap"] = fallback["market_cap"]
    if merged.get("ipo_date") is None and fallback.get("ipo_date") is not None:
        merged["ipo_date"] = fallback["ipo_date"]

    sources: list[str] = []
    if primary.get("company_name") or primary.get("display_name"):
        sources.append(str(primary.get("source") or "yfinance"))
    fallback_source = fallback.get("source")
    if (fallback.get("company_name") or fallback.get("display_name")) and fallback_source:
        if fallback_source not in sources:
            sources.append(str(fallback_source))
    merged["source"] = "+".join(sources) if sources else "none"
    merged["asset_type"] = "stock"
    return merged


async def _fetch_stock_profile(ticker: str, api_key: str) -> tuple[dict[str, Any], dict, FinnhubError | None]:
    raw, error = await fetch_json(
        "/stock/profile2",
        api_key,
        FinnhubCapability.STOCK_PROFILE,
        params={"symbol": ticker},
    )
    if error:
        return {}, {}, error
    if not raw or not raw.get("name"):
        return {}, raw if isinstance(raw, dict) else {}, None
    mapped = {
        "asset_type": "stock",
        "company_name": raw.get("name"),
        "display_name": raw.get("name"),
        "sector": raw.get("finnhubIndustry"),
        "industry": raw.get("finnhubIndustry"),
        "logo_url": raw.get("logo"),
        "website": raw.get("weburl"),
        "exchange": raw.get("exchange"),
        "country": raw.get("country"),
        "currency": raw.get("currency"),
        "market_cap": _market_cap_from_finnhub(raw),
        "ipo_date": _parse_ipo_date(raw.get("ipo")),
        "source": "finnhub",
    }
    return mapped, raw, None


async def _fetch_crypto_profile(ticker: str) -> tuple[dict[str, Any], dict]:
    metrics = await _crypto.fetch_metrics(ticker)
    if not metrics:
        return {}, {}
    symbol = _crypto.extract_symbol(ticker)
    mapped = {
        "asset_type": "crypto",
        "company_name": metrics.get("name"),
        "display_name": metrics.get("name") or symbol,
        "sector": metrics.get("category") or "Crypto",
        "industry": metrics.get("category"),
        "logo_url": None,
        "website": None,
        "exchange": None,
        "country": None,
        "currency": ticker.split("-")[-1].upper() if "-" in ticker else "USD",
        "market_cap": metrics.get("market_cap"),
        "ipo_date": None,
        "source": "coingecko",
    }
    return mapped, metrics


async def refresh_ticker_metadata(
    ticker: str,
    db: AsyncSession,
    finnhub_key: Optional[str] = None,
) -> TickerMetadata:
    """Fetch provider data and upsert a ticker_metadata row."""
    normalized = normalize_ticker(ticker)
    now = datetime.now(timezone.utc)

    mapped: dict[str, Any] = {}
    payload: dict = {}
    profile_error: FinnhubError | None = None
    try:
        if is_crypto(normalized):
            mapped, payload = await _fetch_crypto_profile(normalized)
        else:
            yf_raw: dict | None = None
            fh_raw: dict = {}
            fh_mapped: dict[str, Any] = {}
            try:
                yf_raw = await _yf.fetch_company_profile(normalized)
            except Exception as exc:
                logger.warning("yfinance profile failed for %s: %s", normalized, exc)
            yf_mapped = _map_yfinance_profile(yf_raw) if yf_raw else {}

            if finnhub_key:
                fh_mapped, fh_raw, profile_error = await _fetch_stock_profile(
                    normalized, finnhub_key
                )

            if yf_mapped.get("company_name"):
                mapped = (
                    _merge_stock_profiles(yf_mapped, fh_mapped)
                    if fh_mapped.get("company_name")
                    else yf_mapped
                )
            elif fh_mapped.get("company_name"):
                mapped = fh_mapped
            else:
                mapped = {"asset_type": "stock", "source": "none"}

            payload = {}
            if yf_raw:
                payload["yfinance"] = yf_raw
            if fh_raw:
                payload["finnhub"] = fh_raw
    except Exception as exc:
        logger.warning("ticker metadata refresh failed for %s: %s", normalized, exc)
        mapped = {}
    if profile_error:
        logger.info(
            "ticker metadata entitlement failure for %s: %s",
            normalized,
            profile_error.reason.value,
        )

    success = bool(mapped.get("company_name") or mapped.get("display_name"))
    ttl = _METADATA_TTL if success else _FAILURE_TTL
    expires_at = now + ttl

    existing = await db.get(TickerMetadata, normalized)
    if existing is None:
        row = TickerMetadata(
            ticker=normalized,
            asset_type=mapped.get("asset_type") or ("crypto" if is_crypto(normalized) else "stock"),
            fetched_at=now,
            expires_at=expires_at,
        )
        db.add(row)
    else:
        row = existing
        row.updated_at = now

    row.asset_type = mapped.get("asset_type") or row.asset_type
    if success or existing is None:
        row.company_name = mapped.get("company_name")
        row.display_name = mapped.get("display_name")
        row.sector = mapped.get("sector")
        row.industry = mapped.get("industry")
        row.logo_url = mapped.get("logo_url")
        row.website = mapped.get("website")
        row.exchange = mapped.get("exchange")
        row.country = mapped.get("country")
        row.currency = mapped.get("currency")
        row.market_cap = mapped.get("market_cap")
        row.ipo_date = mapped.get("ipo_date")
        row.source = mapped.get("source") or row.source
        if payload:
            row.source_payload = payload
    row.fetched_at = now
    row.expires_at = expires_at

    await db.commit()
    await db.refresh(row)

    from app.services import logo_cache_service

    try:
        await logo_cache_service.ensure_logo_for_ticker(
            normalized,
            logo_url=row.logo_url,
            website=row.website,
        )
    except Exception as exc:
        logger.warning("logo cache warm failed for %s: %s", normalized, exc)

    return row


async def get_ticker_metadata(
    ticker: str,
    db: AsyncSession,
    finnhub_key: Optional[str] = None,
    *,
    force_refresh: bool = False,
) -> TickerMetadata:
    normalized = normalize_ticker(ticker)
    row = await db.get(TickerMetadata, normalized)
    if row is not None and not force_refresh and not is_stale(row):
        return row
    return await refresh_ticker_metadata(normalized, db, finnhub_key)


async def get_many_ticker_metadata(
    tickers: list[str],
    db: AsyncSession,
    finnhub_key: Optional[str] = None,
    *,
    force_refresh: bool = False,
) -> dict[str, TickerMetadata]:
    normalized = list(dict.fromkeys(normalize_ticker(t) for t in tickers if t and t.strip()))
    if not normalized:
        return {}

    result = await db.execute(
        select(TickerMetadata).where(TickerMetadata.ticker.in_(normalized))
    )
    by_ticker = {row.ticker: row for row in result.scalars().all()}

    to_refresh: list[str] = []
    for t in normalized:
        row = by_ticker.get(t)
        if force_refresh or row is None or is_stale(row):
            to_refresh.append(t)

    # Refresh sequentially — AsyncSession is not safe for concurrent commits.
    for sym in to_refresh:
        by_ticker[sym] = await refresh_ticker_metadata(sym, db, finnhub_key)

    return {t: by_ticker[t] for t in normalized if t in by_ticker}
