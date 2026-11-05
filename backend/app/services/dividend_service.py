"""Dividend history store (dividend_history + dividend_sync).

Per-share cash dividends by ex-date from yfinance (split-adjusted, free, no
key), kept for 10 years. Like the price store, a refresh replaces a symbol's
whole history, because split adjustments rewrite past amounts. A symbol that
pays nothing still gets a dividend_sync row, so it is not refetched on every
request. Downloads run two at a time with retry back-off, and a symbol that
keeps failing cools down for 5 minutes (Yahoo rate-limits bursts).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dividend import DividendHistory, DividendSync

logger = logging.getLogger(__name__)

HISTORY_YEARS = 10
FRESH_FOR = timedelta(hours=24)
FAILURE_COOLDOWN = timedelta(minutes=5)
RETRY_DELAYS_S: tuple[float, ...] = (2.0, 5.0)
_DOWNLOAD_CONCURRENCY = 2
_recent_failures: dict[str, datetime] = {}


def _sync_download(symbol: str) -> list[tuple[date, float]]:
    import yfinance as yf

    series = yf.Ticker(symbol).dividends
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=365 * HISTORY_YEARS + 5)
    out = []
    for ts, amount in series.items():
        d = ts.date() if hasattr(ts, "date") else ts
        if d >= cutoff and float(amount) > 0:
            out.append((d, float(amount)))
    return out


async def _download_dividends(symbol: str) -> list[tuple[date, float]]:
    """Per-share dividends (ex-date, amount), oldest first; [] for non-payers. Raises on failure."""
    from app.services.yfinance_service import _get_yf_semaphore

    async with _get_yf_semaphore():
        return sorted(await asyncio.to_thread(_sync_download, symbol))


async def refresh(db: AsyncSession, symbols: list[str], *, force: bool = False) -> set[str]:
    """Fetch symbols whose history is missing or older than FRESH_FOR. Returns
    the symbols that failed; their previously stored history is kept."""
    symbols = sorted({s.strip().upper() for s in symbols if s and s.strip()})
    if not symbols:
        return set()
    now = datetime.now(timezone.utc)
    synced = {r.symbol: r.fetched_at for r in (await db.execute(
        select(DividendSync).where(DividendSync.symbol.in_(symbols)))).scalars()}
    stale = [s for s in symbols if force or s not in synced or now - synced[s] > FRESH_FOR]
    failed = {s for s in stale if not force and s in _recent_failures and now - _recent_failures[s] < FAILURE_COOLDOWN}
    stale = [s for s in stale if s not in failed]
    gate = asyncio.Semaphore(_DOWNLOAD_CONCURRENCY)

    async def _one(sym: str):
        async with gate:
            for attempt in range(len(RETRY_DELAYS_S) + 1):
                try:
                    return sym, await _download_dividends(sym)
                except Exception as exc:  # noqa: BLE001 - one bad ticker must not fail the rest
                    if attempt == len(RETRY_DELAYS_S):
                        logger.info("dividend download failed for %s: %s", sym, exc)
                        return sym, None
                    await asyncio.sleep(RETRY_DELAYS_S[attempt])
        return sym, None

    for sym, divs in await asyncio.gather(*(_one(s) for s in stale)):
        if divs is None:
            failed.add(sym)
            _recent_failures[sym] = now
            continue
        _recent_failures.pop(sym, None)
        await db.execute(delete(DividendHistory).where(DividendHistory.symbol == sym))
        if divs:
            await db.execute(insert(DividendHistory).values(
                [{"symbol": sym, "ex_date": d, "amount": a} for d, a in divs]).on_conflict_do_nothing())
        stmt = insert(DividendSync).values(symbol=sym, fetched_at=now, payments=len(divs))
        await db.execute(stmt.on_conflict_do_update(
            index_elements=[DividendSync.symbol], set_={"fetched_at": now, "payments": len(divs)}))
    await db.commit()
    return failed


async def load(db: AsyncSession, symbols: list[str]) -> dict[str, list[tuple[date, float]]]:
    out: dict[str, list[tuple[date, float]]] = {s: [] for s in symbols}
    if not symbols:
        return out
    rows = await db.execute(select(DividendHistory.symbol, DividendHistory.ex_date, DividendHistory.amount)
                            .where(DividendHistory.symbol.in_(symbols)).order_by(DividendHistory.ex_date))
    for sym, d, a in rows.all():
        out[sym].append((d, a))
    return out


async def get_dividends(db: AsyncSession, symbols: list[str]) -> tuple[dict[str, list[tuple[date, float]]], set[str]]:
    failed = await refresh(db, symbols)
    return await load(db, symbols), failed


async def refresh_tracked_dividends() -> None:
    """Nightly scheduler job: re-download dividends for every held ticker."""
    from app.database import AsyncSessionLocal
    from app.services.price_history_service import DEFAULT_BENCHMARKS, tracked_symbols

    async with AsyncSessionLocal() as db:
        symbols = [s for s in await tracked_symbols(db) if s not in DEFAULT_BENCHMARKS]
        failed = await refresh(db, symbols, force=True)
    logger.info("dividends refreshed for %d symbols (%d failed)", len(symbols), len(failed))
