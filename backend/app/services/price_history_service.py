"""Daily price history store (the `price_bars` table).

One shared source of adjusted daily closes for portfolio performance and
risk. Prices come from yfinance (free, no key) and are cached in Postgres,
so they survive restarts and are shared by every portfolio holding the
same symbol.

Each refresh re-downloads and replaces a symbol's whole window
(HISTORY_YEARS). Adjusted closes are revised upstream after every dividend
and split, so stitching a new fetch onto old rows would create fake jumps.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.portfolio import PortfolioSnapshot
from app.models.price_bar import PriceBar
from app.services import yfinance_service

logger = logging.getLogger(__name__)

HISTORY_YEARS = 5
FRESH_FOR = timedelta(hours=12)
DEFAULT_BENCHMARKS = ("SPY", "QQQ")
_INSERT_CHUNK = 2000

# Yahoo rate-limits bursts (YFRateLimitError), so downloads run two at a time,
# each retried with back-off, and a symbol that still fails is not retried for
# FAILURE_COOLDOWN, so repeated page loads cannot keep hammering it.
_DOWNLOAD_CONCURRENCY = 2
RETRY_DELAYS_S: tuple[float, ...] = (2.0, 5.0)
FAILURE_COOLDOWN = timedelta(minutes=5)
_recent_failures: dict[str, datetime] = {}


def history_start(today: date | None = None) -> date:
    today = today or datetime.now(timezone.utc).date()
    return today - timedelta(days=365 * HISTORY_YEARS + 10)


async def _download_closes(symbol: str, start: date) -> dict[date, float]:
    """Adjusted daily closes from `start` to today. Raises on failure."""
    frame = await yfinance_service.fetch_history(symbol, start=start.isoformat(), interval="1d", auto_adjust=True)
    closes = frame["Close"].dropna()
    out: dict[date, float] = {}
    for ts, value in closes.items():
        price = float(value)
        if price > 0:
            out[ts.date() if hasattr(ts, "date") else ts] = price
    if not out:
        raise ValueError(f"no closes returned for {symbol}")
    return out


async def _stored_fetch_times(db: AsyncSession, symbols: list[str]) -> dict[str, datetime]:
    if not symbols:
        return {}
    rows = await db.execute(
        select(PriceBar.symbol, func.max(PriceBar.fetched_at)).where(PriceBar.symbol.in_(symbols)).group_by(PriceBar.symbol)
    )
    return {sym: ts for sym, ts in rows.all()}


async def _replace_symbol(db: AsyncSession, symbol: str, closes: dict[date, float], fetched_at: datetime) -> None:
    await db.execute(delete(PriceBar).where(PriceBar.symbol == symbol))
    rows = [{"symbol": symbol, "date": d, "close": c, "fetched_at": fetched_at} for d, c in sorted(closes.items())]
    for i in range(0, len(rows), _INSERT_CHUNK):
        stmt = insert(PriceBar).values(rows[i:i + _INSERT_CHUNK])
        stmt = stmt.on_conflict_do_update(
            index_elements=[PriceBar.symbol, PriceBar.date],
            set_={"close": stmt.excluded.close, "fetched_at": stmt.excluded.fetched_at},
        )
        await db.execute(stmt)


async def refresh_symbols(db: AsyncSession, symbols: list[str], *, force: bool = False) -> set[str]:
    """Download any symbol whose stored history is missing or older than
    FRESH_FOR (all of them when `force`). Returns the symbols whose download
    failed; their previously stored rows, if any, are kept."""
    symbols = sorted({s.strip().upper() for s in symbols if s and s.strip()})
    now = datetime.now(timezone.utc)
    stored = await _stored_fetch_times(db, symbols)
    stale = [s for s in symbols if force or s not in stored or now - stored[s] > FRESH_FOR]
    if not stale:
        return set()

    failed: set[str] = set()
    if not force:
        cooling = {s for s in stale if s in _recent_failures and now - _recent_failures[s] < FAILURE_COOLDOWN}
        failed |= cooling
        stale = [s for s in stale if s not in cooling]

    start = history_start(now.date())
    gate = asyncio.Semaphore(_DOWNLOAD_CONCURRENCY)

    async def _one(sym: str):
        async with gate:
            for attempt in range(len(RETRY_DELAYS_S) + 1):
                try:
                    return sym, await _download_closes(sym, start)
                except Exception as exc:  # noqa: BLE001 - one bad ticker must not fail the rest
                    if attempt == len(RETRY_DELAYS_S):
                        logger.info("price history download failed for %s: %s", sym, exc)
                        return sym, None
                    await asyncio.sleep(RETRY_DELAYS_S[attempt])
        return sym, None

    for sym, closes in await asyncio.gather(*(_one(s) for s in stale)):
        if closes is None:
            failed.add(sym)
            _recent_failures[sym] = now
            continue
        _recent_failures.pop(sym, None)
        await _replace_symbol(db, sym, closes, now)
    await db.commit()
    return failed


async def load_closes(db: AsyncSession, symbols: list[str], start: date, end: date) -> dict[str, dict[date, float]]:
    """Stored closes for `symbols` within [start, end], as {symbol: {date: close}}."""
    symbols = sorted({s.upper() for s in symbols})
    out: dict[str, dict[date, float]] = {s: {} for s in symbols}
    if not symbols:
        return out
    rows = await db.execute(
        select(PriceBar.symbol, PriceBar.date, PriceBar.close)
        .where(PriceBar.symbol.in_(symbols), PriceBar.date >= start, PriceBar.date <= end)
        .order_by(PriceBar.symbol, PriceBar.date)
    )
    for sym, d, close in rows.all():
        out[sym][d] = close
    return out


async def get_closes(
    db: AsyncSession, symbols: list[str], start: date, end: date
) -> tuple[dict[str, dict[date, float]], set[str]]:
    """Refresh stale symbols, then return (closes, symbols whose refresh failed)."""
    failed = await refresh_symbols(db, symbols)
    return await load_closes(db, symbols, start, end), failed


async def tracked_symbols(db: AsyncSession) -> list[str]:
    """Tickers in every portfolio's latest snapshot, plus the default benchmarks."""
    latest = (
        select(PortfolioSnapshot.portfolio_id, func.max(PortfolioSnapshot.uploaded_at).label("ts"))
        .group_by(PortfolioSnapshot.portfolio_id)
        .subquery()
    )
    snaps = (
        await db.execute(
            select(PortfolioSnapshot)
            .join(latest, (PortfolioSnapshot.portfolio_id == latest.c.portfolio_id) & (PortfolioSnapshot.uploaded_at == latest.c.ts))
        )
    ).scalars().all()
    symbols = set(DEFAULT_BENCHMARKS)
    for snap in snaps:
        await db.refresh(snap, ["holdings"])
        symbols.update(h.ticker.upper() for h in snap.holdings)
    return sorted(symbols)


async def refresh_tracked_price_history() -> None:
    """Nightly scheduler job: re-download every tracked symbol."""
    async with AsyncSessionLocal() as db:
        symbols = await tracked_symbols(db)
        failed = await refresh_symbols(db, symbols, force=True)
    logger.info("price history refreshed for %d symbols (%d failed)", len(symbols), len(failed))
