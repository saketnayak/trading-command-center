"""
Stock price fetching via Yahoo Finance (yfinance).
Used as a no-key fallback when no Finnhub API key is configured.
Data is 15-minute delayed for US equities. Returns None gracefully on failure.

NOTE: yfinance is a synchronous library; all calls are wrapped in asyncio.to_thread.
Non-US tickers may require exchange suffixes (e.g. BRN.AX, GSK.L) to resolve
correctly on Yahoo Finance — bare symbols without suffixes are tried as-is and
will return None if Yahoo cannot resolve them.
"""
import asyncio
import logging
import weakref
from typing import Optional

import yfinance as yf

logger = logging.getLogger(__name__)

# Lazily initialized per event loop to avoid loop-mismatch errors in multi-loop
# environments (e.g. pytest-asyncio with function-scoped loops).
_yf_semaphores: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _get_yf_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    if loop not in _yf_semaphores:
        _yf_semaphores[loop] = asyncio.Semaphore(5)
    return _yf_semaphores[loop]


def _sync_fetch_price(ticker: str) -> Optional[float]:
    """Synchronous price fetch via yfinance fast_info.
    Returns current/last traded price, falling back to previous close."""
    try:
        info = yf.Ticker(ticker).fast_info
        last = getattr(info, "last_price", None)
        prev = getattr(info, "previous_close", None)
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
