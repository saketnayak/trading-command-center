"""
Crypto price and metrics fetching.
Primary: CoinGecko (free, no key required).
Fallback: Finnhub crypto candle endpoint (requires stored Finnhub key).
"""

import asyncio
import time
from datetime import date, datetime, timezone as tz, timedelta
from typing import Optional

import httpx

from app.schemas.money import PriceQuote
from app.utils.quote_currency import quote_currency_from_ticker
from app.services.finnhub_client import (
    FinnhubCapability,
    fetch_json,
)

_CG_BASE = "https://api.coingecko.com/api/v3"

# Symbol → CoinGecko coin ID mapping for common coins.
# Populated statically; dynamic lookup via /search is used as fallback.
_ID_MAP: dict[str, str] = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "ADA": "cardano",
    "DOGE": "dogecoin",
    "AVAX": "avalanche-2",
    "SHIB": "shiba-inu",
    "DOT": "polkadot",
    "LINK": "chainlink",
    "MATIC": "matic-network",
    "POL": "matic-network",
    "UNI": "uniswap",
    "LTC": "litecoin",
    "ATOM": "cosmos",
    "XLM": "stellar",
    "ALGO": "algorand",
    "NEAR": "near",
    "APT": "aptos",
    "ARB": "arbitrum",
    "OP": "optimism",
    "SUI": "sui",
    "INJ": "injective-protocol",
    "TIA": "celestia",
    "FIL": "filecoin",
    "VET": "vechain",
    "HBAR": "hedera-hashgraph",
    "ICP": "internet-computer",
    "RENDER": "render-token",
    "GRT": "the-graph",
    "AAVE": "aave",
    "MKR": "maker",
    "CRV": "curve-dao-token",
    "LDO": "lido-dao",
    "PEPE": "pepe",
    "FLOKI": "floki",
    "WIF": "dogwifcoin",
    "BONK": "bonk",
    "JUP": "jupiter-exchange-solana",
    "TON": "the-open-network",
    "TRX": "tron",
    "USDT": "tether",
    "USDC": "usd-coin",
}

# Cache: symbol → (coingecko_id, expiry_ts)
_id_cache: dict[str, tuple[str, float]] = {}
_id_lock: asyncio.Lock | None = None
# Cache: ticker → (PriceQuote, expiry_ts)
_price_cache: dict[str, tuple[PriceQuote, float]] = {}
_PRICE_TTL = 300  # 5 min — crypto moves fast


def _quote_currency_for_ticker(ticker: str) -> str:
    return quote_currency_from_ticker(ticker) or "USD"


def _get_id_lock() -> asyncio.Lock:
    global _id_lock
    if _id_lock is None:
        _id_lock = asyncio.Lock()
    return _id_lock


def extract_symbol(ticker: str) -> str:
    """BTC-USD → BTC, ETH-USDC → ETH"""
    return ticker.split("-")[0].upper()


async def coingecko_id(symbol: str) -> Optional[str]:
    """Public wrapper — resolve a crypto symbol to its CoinGecko ID."""
    return await _coingecko_id(symbol)


async def _coingecko_id(symbol: str) -> Optional[str]:
    """Resolve a crypto symbol to its CoinGecko ID, with caching."""
    now = time.time()
    cached = _id_cache.get(symbol)
    if cached and now < cached[1]:
        return cached[0]

    if symbol in _ID_MAP:
        _id_cache[symbol] = (_ID_MAP[symbol], now + 86400)
        return _ID_MAP[symbol]

    # Dynamic search fallback — serialize under lock to avoid parallel /search calls for same symbol
    async with _get_id_lock():
        # Re-check inside lock
        cached = _id_cache.get(symbol)
        if cached and now < cached[1]:
            return cached[0]
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(f"{_CG_BASE}/search", params={"query": symbol})
                r.raise_for_status()
                data = r.json()
            for coin in data.get("coins", []):
                if coin.get("symbol", "").upper() == symbol:
                    cg_id = coin["id"]
                    _id_cache[symbol] = (cg_id, now + 86400)
                    _ID_MAP[symbol] = cg_id
                    return cg_id
        except Exception:
            pass
    return None


async def _finnhub_price(symbol: str, finnhub_key: str, now: float) -> Optional[float]:
    """Single Finnhub crypto/candle call — shared by fetch_price and fetch_prices_batch."""
    to_ts = int(now)
    from_ts = to_ts - 86400
    raw, error = await fetch_json(
        "/crypto/candle",
        finnhub_key,
        FinnhubCapability.CRYPTO_CANDLE,
        params={
            "symbol": f"BINANCE:{symbol}USDT",
            "resolution": "D",
            "from": from_ts,
            "to": to_ts,
        },
    )
    if error is None and isinstance(raw, dict) and raw.get("s") == "ok" and raw.get("c"):
        return float(raw["c"][-1])
    return None


async def fetch_price(ticker: str, finnhub_key: Optional[str] = None) -> Optional[float]:
    """
    Current price for a single crypto ticker (amount only).
    Prefer fetch_prices_batch when pricing multiple tickers to avoid rate limits.
    """
    quote = await fetch_price_quote(ticker, finnhub_key=finnhub_key)
    return quote.amount if quote else None


async def fetch_price_quote(
    ticker: str,
    finnhub_key: Optional[str] = None,
) -> Optional[PriceQuote]:
    """Current price + quote currency for a single crypto ticker."""
    result = await fetch_prices_batch([ticker], finnhub_key=finnhub_key)
    return result.get(ticker)


async def fetch_prices_batch(
    tickers: list[str],
    finnhub_key: Optional[str] = None,
) -> dict[str, Optional[PriceQuote]]:
    """
    Fetch current prices for multiple crypto tickers using batched CoinGecko
    /simple/price calls grouped by quote currency.
    Falls back to Finnhub individually for any ticker CoinGecko doesn't return.
    """
    if not tickers:
        return {}

    now = time.time()
    result: dict[str, Optional[PriceQuote]] = {}
    uncached: list[str] = []

    for ticker in tickers:
        cached = _price_cache.get(ticker)
        if cached and now < cached[1]:
            result[ticker] = cached[0]
        else:
            uncached.append(ticker)

    if not uncached:
        return result

    # Resolve CoinGecko IDs concurrently (each uses the lock internally if needed)
    symbols = [extract_symbol(t) for t in uncached]
    cg_ids = await asyncio.gather(*[_coingecko_id(s) for s in symbols])

    # Group tickers by CoinGecko ID and track desired vs currency per ticker
    id_to_tickers: dict[str, list[str]] = {}
    ticker_vs: dict[str, str] = {}
    for ticker, cg_id, symbol in zip(uncached, cg_ids, symbols):
        ticker_vs[ticker] = _quote_currency_for_ticker(ticker).lower()
        if cg_id:
            id_to_tickers.setdefault(cg_id, []).append(ticker)

    # Batch CoinGecko calls per vs_currency
    vs_groups: dict[str, set[str]] = {}
    for cg_id, group_tickers in id_to_tickers.items():
        for ticker in group_tickers:
            vs = ticker_vs[ticker]
            vs_groups.setdefault(vs, set()).add(cg_id)

    for vs, cg_id_set in vs_groups.items():
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(
                    f"{_CG_BASE}/simple/price",
                    params={"ids": ",".join(cg_id_set), "vs_currencies": vs},
                )
                r.raise_for_status()
                data = r.json()
            for cg_id, price_data in data.items():
                amount = price_data.get(vs)
                if amount is None:
                    continue
                quote = PriceQuote(amount=float(amount), currency=vs.upper())
                for ticker in id_to_tickers.get(cg_id, []):
                    if ticker_vs[ticker] != vs:
                        continue
                    result[ticker] = quote
                    _price_cache[ticker] = (quote, now + _PRICE_TTL)
        except Exception:
            pass

    # ── Finnhub fallback for anything still missing (USD/USDT pairs) ─────────
    missing = [
        t
        for t in uncached
        if t not in result and _quote_currency_for_ticker(t) in ("USD", "USDT")
    ]
    if missing and finnhub_key:
        fallback_tasks = [
            _finnhub_price(extract_symbol(t), finnhub_key, now) for t in missing
        ]
        fallback_prices = await asyncio.gather(*fallback_tasks)
        for ticker, price in zip(missing, fallback_prices):
            if price is not None:
                quote = PriceQuote(amount=price, currency=_quote_currency_for_ticker(ticker))
                result[ticker] = quote
                _price_cache[ticker] = (quote, now + _PRICE_TTL)

    for ticker in uncached:
        result.setdefault(ticker, None)

    return result


async def fetch_historical_price(
    ticker: str,
    target_date: date,
    finnhub_key: Optional[str] = None,
) -> Optional[float]:
    """
    Closing price on a specific date for outcome tracking.
    1. CoinGecko coins/{id}/history
    2. Finnhub crypto/candle (7-day window ending at target_date)
    """
    symbol = extract_symbol(ticker)

    # ── CoinGecko ──────────────────────────────────────────────────────────────
    cg_id = await _coingecko_id(symbol)
    if cg_id:
        try:
            date_str = target_date.strftime("%d-%m-%Y")
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{_CG_BASE}/coins/{cg_id}/history",
                    params={"date": date_str, "localization": "false"},
                )
                r.raise_for_status()
                data = r.json()
            usd = data.get("market_data", {}).get("current_price", {}).get("usd")
            if usd is not None:
                return float(usd)
        except Exception:
            pass

    # ── Finnhub fallback ───────────────────────────────────────────────────────
    if finnhub_key:
        to_dt = datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59, tzinfo=tz.utc)
        from_dt = to_dt - timedelta(days=7)
        raw, _error = await fetch_json(
            "/crypto/candle",
            finnhub_key,
            FinnhubCapability.CRYPTO_CANDLE,
            params={
                "symbol": f"BINANCE:{symbol}USDT",
                "resolution": "D",
                "from": int(from_dt.timestamp()),
                "to": int(to_dt.timestamp()),
            },
            timeout=10,
        )
        if isinstance(raw, dict) and raw.get("s") == "ok" and raw.get("c"):
            return float(raw["c"][-1])

    return None


# Cache: symbol → (metrics_dict, expiry_ts)
_metrics_cache: dict[str, tuple[dict, float]] = {}
_METRICS_TTL = 3600  # 1 hour


async def fetch_metrics(ticker: str) -> dict:
    """
    Crypto-specific metrics from CoinGecko: market cap, 24h volume,
    circulating supply, ATH, 24h/7d price change, category.
    """
    symbol = extract_symbol(ticker)
    now = time.time()
    if symbol in _metrics_cache:
        data, expiry = _metrics_cache[symbol]
        if now < expiry:
            return data

    cg_id = await _coingecko_id(symbol)
    if not cg_id:
        return {}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{_CG_BASE}/coins/{cg_id}",
                params={
                    "localization": "false",
                    "tickers": "false",
                    "community_data": "false",
                    "developer_data": "false",
                },
            )
            r.raise_for_status()
            raw = r.json()
        md = raw.get("market_data", {})
        raw_desc = (raw.get("description") or {}).get("en", "") or ""
        import re as _re, html as _html
        clean_desc = _html.unescape(_re.sub(r"<[^>]+>", " ", raw_desc)).strip()
        data = {
            "name": raw.get("name"),
            "description": clean_desc[:400] if clean_desc else None,
            "market_cap": md.get("market_cap", {}).get("usd"),
            "volume_24h": md.get("total_volume", {}).get("usd"),
            "circulating_supply": md.get("circulating_supply"),
            "max_supply": md.get("max_supply"),
            "all_time_high": md.get("ath", {}).get("usd"),
            "ath_date": (md.get("ath_date") or {}).get("usd"),
            "price_change_24h_pct": md.get("price_change_percentage_24h"),
            "price_change_7d_pct": md.get("price_change_percentage_7d"),
            "category": (raw.get("categories") or [None])[0],
        }
        _metrics_cache[symbol] = (data, now + _METRICS_TTL)
        return data
    except Exception:
        return {}


async def fetch_category(ticker: str) -> str:
    """Return a human-readable category for portfolio sector grouping."""
    metrics = await fetch_metrics(ticker)
    return metrics.get("category") or "Crypto"
