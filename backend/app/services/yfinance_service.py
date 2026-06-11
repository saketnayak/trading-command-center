"""
Stock price fetching via Yahoo Finance (yfinance).
Used as a fallback when Finnhub is unavailable, rate-limited, or not configured.
Data is 15-minute delayed for US equities. Returns None gracefully on failure.

NOTE: yfinance is a synchronous library; all calls are wrapped in asyncio.to_thread.
Non-US tickers may require exchange suffixes (e.g. BRN.AX, GSK.L) to resolve
correctly on Yahoo Finance — bare symbols without suffixes are tried as-is and
will return None if Yahoo cannot resolve them.
"""
import asyncio
import logging
import time
import weakref
from datetime import date, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

_HISTORY_CACHE_TTL = 14400  # 4 hours
_OHLCV_COLUMNS = ["Open", "High", "Low", "Close", "Volume"]
_history_cache: dict[str, tuple[pd.DataFrame, float]] = {}

# Lazily initialized per event loop to avoid loop-mismatch errors in multi-loop
# environments (e.g. pytest-asyncio with function-scoped loops).
_yf_semaphores: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _get_yf_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    if loop not in _yf_semaphores:
        _yf_semaphores[loop] = asyncio.Semaphore(5)
    return _yf_semaphores[loop]


def _fast_info_value(info, key: str):
    try:
        value = getattr(info, key)
    except Exception:
        value = None
    if value is None:
        try:
            value = info.get(key)
        except Exception:
            value = None
    return value


def _sync_fetch_price(ticker: str) -> Optional[float]:
    """Synchronous price fetch via yfinance fast_info.
    Returns current/last traded price, falling back to previous close."""
    try:
        info = yf.Ticker(ticker).fast_info
        last = _fast_info_value(info, "last_price")
        prev = _fast_info_value(info, "previous_close")
        if last is not None and last != 0:
            return float(last)
        if prev is not None and prev != 0:
            return float(prev)
        return None
    except Exception:
        logger.debug("yfinance price fetch failed for %s", ticker)
        return None


async def fetch_price(ticker: str) -> Optional[float]:
    """Async wrapper: fetches stock price via Yahoo Finance with concurrency throttling."""
    async with _get_yf_semaphore():
        return await asyncio.to_thread(_sync_fetch_price, ticker)


def _sync_fetch_quote(ticker: str) -> Optional[dict]:
    """Synchronous quote fetch via yfinance fast_info."""
    try:
        info = yf.Ticker(ticker).fast_info
        last = _fast_info_value(info, "last_price")
        previous_close = _fast_info_value(info, "previous_close")
        day_high = _fast_info_value(info, "day_high")
        day_low = _fast_info_value(info, "day_low")

        price = float(last) if last is not None and last != 0 else None
        prev = float(previous_close) if previous_close is not None and previous_close != 0 else None
        if price is None:
            price = prev
        if price is None:
            return None

        change = price - prev if prev else None
        change_pct = (change / prev * 100) if change is not None and prev else None
        return {
            "price": price,
            "change_pct": change_pct,
            "change": change,
            "high": float(day_high) if day_high is not None and day_high != 0 else None,
            "low": float(day_low) if day_low is not None and day_low != 0 else None,
            "prev_close": prev,
        }
    except Exception:
        logger.debug("yfinance quote fetch failed for %s", ticker)
        return None


async def fetch_quote(ticker: str) -> Optional[dict]:
    """Async wrapper: fetches a stock quote via Yahoo Finance."""
    async with _get_yf_semaphore():
        return await asyncio.to_thread(_sync_fetch_quote, ticker)


def prepare_ohlcv_frame(data: pd.DataFrame, symbol: str = "") -> pd.DataFrame:
    """Select and clean OHLCV columns expected by Elliott Wave analysis."""
    missing = [column for column in _OHLCV_COLUMNS if column not in data.columns]
    if missing:
        label = symbol or "symbol"
        raise ValueError(f"Missing required columns for {label}: {missing}")

    frame = data[_OHLCV_COLUMNS].copy()
    frame = frame.dropna()
    frame.index = pd.to_datetime(frame.index)
    return frame


def _normalize_history_frame(data: pd.DataFrame | None, symbol: str) -> pd.DataFrame:
    if data is None or data.empty:
        raise ValueError(f"No historical price data available for {symbol}")

    normalized = data.copy()
    if isinstance(normalized.columns, pd.MultiIndex):
        normalized.columns = normalized.columns.get_level_values(0)
    return normalized


def _download_history_sync(
    symbol: str,
    *,
    start: str | None = None,
    end: str | None = None,
    period: str | None = None,
    interval: str = "1d",
    auto_adjust: bool = True,
) -> pd.DataFrame:
    if period is not None:
        data = yf.download(
            symbol,
            period=period,
            interval=interval,
            auto_adjust=auto_adjust,
            progress=False,
            threads=False,
        )
    else:
        data = yf.download(
            symbol,
            start=start,
            end=end,
            interval=interval,
            auto_adjust=auto_adjust,
            progress=False,
            threads=False,
        )
    return _normalize_history_frame(data, symbol)


def _get_cached_history(cache_key: str) -> pd.DataFrame | None:
    cached = _history_cache.get(cache_key)
    if cached is None:
        return None

    data, expiry = cached
    if time.time() >= expiry:
        _history_cache.pop(cache_key, None)
        return None
    return data.copy()


async def fetch_history(
    symbol: str,
    *,
    start: str | None = None,
    end: str | None = None,
    interval: str = "1d",
    auto_adjust: bool = True,
) -> pd.DataFrame:
    """Fetch historical OHLCV data using a shared in-process cache."""
    normalized = symbol.strip().upper()
    cache_key = f"start-end:{normalized}:{start or ''}:{end or ''}:{interval}:{auto_adjust}"

    cached = _get_cached_history(cache_key)
    if cached is not None:
        return cached

    async with _get_yf_semaphore():
        cached = _get_cached_history(cache_key)
        if cached is not None:
            return cached

        data = await asyncio.to_thread(
            _download_history_sync,
            normalized,
            start=start,
            end=end,
            interval=interval,
            auto_adjust=auto_adjust,
        )

    _history_cache[cache_key] = (data.copy(), time.time() + _HISTORY_CACHE_TTL)
    return data.copy()


async def fetch_history_period(
    symbol: str,
    *,
    period: str = "2y",
    interval: str = "1d",
    auto_adjust: bool = True,
) -> pd.DataFrame:
    """Fetch period-based historical OHLCV data using a shared in-process cache."""
    normalized = symbol.strip().upper()
    cache_key = f"period:{normalized}:{period}:{interval}:{auto_adjust}"

    cached = _get_cached_history(cache_key)
    if cached is not None:
        return cached

    async with _get_yf_semaphore():
        cached = _get_cached_history(cache_key)
        if cached is not None:
            return cached

        data = await asyncio.to_thread(
            _download_history_sync,
            normalized,
            period=period,
            interval=interval,
            auto_adjust=auto_adjust,
        )

    _history_cache[cache_key] = (data.copy(), time.time() + _HISTORY_CACHE_TTL)
    return data.copy()


async def fetch_historical_close(symbol: str, target_date: date) -> Optional[float]:
    """Return the latest available close in a 7-day window ending at target_date."""
    try:
        start = (target_date - timedelta(days=7)).isoformat()
        end = (target_date + timedelta(days=1)).isoformat()
        frame = await fetch_history(symbol, start=start, end=end, interval="1d")
        closes = frame["Close"].dropna()
        if closes.empty:
            return None
        return float(closes.iloc[-1])
    except Exception:
        logger.debug("yfinance historical close fetch failed for %s", symbol)
        return None
