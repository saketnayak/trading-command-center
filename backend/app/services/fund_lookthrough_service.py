"""ETF look-through (roadmap 3.4): find out which holdings are funds, store what they hold, build the report.

Sources, best first:
- SEC N-PORT (a fund's full holdings, filed quarterly and published with a lag). Needs SEC_USER_AGENT. Not
  every fund files one: unit trusts such as SPY and commodity trusts such as GLD don't.
- Yahoo Finance (the top 10 holdings, the sector split, and whether a ticker is a fund at all). Free and keyless.

A profile is fresh for a week; a failed lookup is retried after a day and keeps the last good data. The maths
is in lookthrough_calc. The report reads stored data only, so it never waits on the network.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.fund_profile import FundProfile
from app.models.portfolio import PortfolioSnapshot
from app.models.sec_filing import SecCik
from app.services import edgar_service, lookthrough_calc
from app.services.performance_calc import PriceLookup
from app.services.portfolio_pricing import aggregate_shares, fx_factors
from app.services.price_history_service import get_closes, history_start
from app.utils.asset_type import is_crypto

logger = logging.getLogger(__name__)

FRESH_FOR = timedelta(days=7)
RETRY_AFTER = timedelta(days=1)
MAX_NPORT_AGE_DAYS = 270
MAX_FILINGS_SCANNED = 60
MF_TICKERS_URL = "https://www.sec.gov/files/company_tickers_mf.json"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/primary_doc.xml"

running: set[str] = set()


def _yahoo_sync(ticker: str) -> dict:
    import yfinance as yf

    t = yf.Ticker(ticker)
    info = t.get_info() or {}
    quote_type = str(info.get("quoteType") or "").upper()
    name = info.get("longName") or info.get("shortName")
    if not quote_type:
        raise ValueError("Yahoo has no data for this ticker")
    if quote_type not in ("ETF", "MUTUALFUND"):
        return {"kind": "stock", "name": name, "sector": info.get("sector")}
    funds = t.funds_data
    top = funds.top_holdings
    weight_col = "Holding Percent"
    return {
        "kind": "fund",
        "name": name,
        "top": [{"ticker": str(sym), "name": str(row.get("Name") or sym), "weight": float(row[weight_col])}
                for sym, row in top.iterrows()],
        "sectors": {str(k): float(v) for k, v in (funds.sector_weightings or {}).items()},
    }


async def _yahoo_profile(ticker: str) -> dict:
    """What Yahoo knows about a ticker. The test seam."""
    return await asyncio.to_thread(_yahoo_sync, ticker)


async def _fund_series() -> dict[str, tuple[int, str]]:
    """Fund ticker → (trust CIK, series ID) from EDGAR's list of funds."""
    data = json.loads(await edgar_service._http_get(MF_TICKERS_URL))
    fields = data["fields"]
    sym, cik, series = fields.index("symbol"), fields.index("cik"), fields.index("seriesId")
    return {str(r[sym]).upper(): (int(r[cik]), str(r[series])) for r in data["data"] if r[sym] and r[series]}


async def _latest_nport(cik: int, series_id: str, today: date) -> dict | None:
    """The newest N-PORT for one series, or None. A trust files one per fund, so each filing's opening bytes
    are checked for the series before downloading it: a sibling fund's filing can run to many megabytes."""
    subs = json.loads(await edgar_service._http_get(edgar_service.SUBMISSIONS_URL.format(cik=cik)))
    recent = subs["filings"]["recent"]
    scanned = 0
    for form, accession in zip(recent["form"], recent["accessionNumber"]):
        if form != "NPORT-P":
            continue
        scanned += 1
        if scanned > MAX_FILINGS_SCANNED:
            return None
        url = ARCHIVE_URL.format(cik=cik, accession=accession.replace("-", ""))
        if series_id not in await edgar_service._http_get_prefix(url):
            continue
        parsed = lookthrough_calc.parse_nport(await edgar_service._http_get(url))
        if parsed["series_id"] != series_id:
            continue
        age = lookthrough_calc.age_days(parsed["as_of"], today)
        return parsed if age is not None and age <= MAX_NPORT_AGE_DAYS else None
    return None


async def _company_maps(db: AsyncSession) -> tuple[dict[str, int], dict[str, tuple[str, int]]]:
    rows = (await db.execute(select(SecCik.ticker, SecCik.cik, SecCik.name))).all()
    by_ticker = {t: c for t, c, _ in rows}
    by_name: dict[str, tuple[str, int]] = {}
    for t, c, n in sorted(rows, key=lambda r: (len(r[0]), r[0])):  # GOOG before GOOGL, for a stable label
        by_name.setdefault(lookthrough_calc.normalize_name(n), (t, c))
    return by_ticker, by_name


async def _refresh_ticker(db: AsyncSession, ticker: str, series: dict[str, tuple[int, str]],
                          by_ticker: dict[str, int], by_name: dict[str, tuple[str, int]],
                          now: datetime) -> None:
    row = await db.get(FundProfile, ticker)
    if row is None:
        row = FundProfile(ticker=ticker, kind="unknown", holdings=[], sectors={}, attempted_at=now)
        db.add(row)
    row.attempted_at = now

    yahoo: dict | None = None
    error: str | None = None
    try:
        yahoo = await _yahoo_profile(ticker)
    except Exception as exc:  # noqa: BLE001 - Yahoo fails in many ways; N-PORT or the last good data can stand in
        error = f"Yahoo: {exc}"[:300]
        logger.warning("look-through: Yahoo failed for %s: %s", ticker, exc)

    found = series.get(edgar_service.normalize_ticker(ticker))
    nport: dict | None = None
    if found:
        try:
            nport = await _latest_nport(found[0], found[1], now.date())
        except Exception as exc:  # noqa: BLE001 - Yahoo's top 10 still works
            logger.warning("look-through: N-PORT failed for %s: %s", ticker, exc)

    if nport:
        holdings = lookthrough_calc.resolve_holdings(nport["equities"], by_ticker, by_name)
        row.kind, row.source, row.as_of = "fund", "sec_nport", nport["as_of"]
        row.covered_weight = min(sum(h["weight"] for h in holdings), 1.0)
        row.holdings = lookthrough_calc.trim_holdings(holdings)
        row.sectors = (yahoo or {}).get("sectors") or row.sectors or {}
        row.name = (yahoo or {}).get("name") or row.name
    elif yahoo and yahoo["kind"] == "fund":
        holdings = lookthrough_calc.resolve_holdings(yahoo["top"], by_ticker, by_name)
        row.kind, row.source, row.as_of = "fund", "yahoo_top10", None
        row.covered_weight = min(sum(h["weight"] for h in holdings), 1.0)
        row.holdings = lookthrough_calc.trim_holdings(holdings)
        row.sectors, row.name = yahoo["sectors"], yahoo.get("name")
    elif yahoo:
        row.kind, row.name, row.sector = "stock", yahoo.get("name"), yahoo.get("sector")
        row.source, row.as_of, row.covered_weight, row.holdings, row.sectors = None, None, None, [], {}
    elif found and row.kind == "unknown":
        row.kind = "fund"  # listed by the SEC as a fund, holdings not available yet

    if nport or yahoo:
        row.fetched_at, row.error = now, None
    else:
        row.error = error or "No data"


def _needs_refresh(row: FundProfile | None, now: datetime) -> bool:
    if row is None:
        return True
    if row.error:
        return now - row.attempted_at >= RETRY_AFTER
    return row.fetched_at is None or now - row.fetched_at >= FRESH_FOR


async def stale_tickers(db: AsyncSession, tickers: list[str]) -> list[str]:
    wanted = [t for t in tickers if not is_crypto(t)]
    rows = (await db.execute(select(FundProfile).where(FundProfile.ticker.in_(wanted)))).scalars().all()
    by = {r.ticker: r for r in rows}
    now = datetime.now(timezone.utc)
    return [t for t in wanted if _needs_refresh(by.get(t), now)]


async def refresh(tickers: list[str], *, force: bool = False, key: str | None = None) -> dict:
    """Look up every ticker that needs it, one at a time. Safe to call for tickers already fresh."""
    report = {"refreshed": 0, "failed": []}
    try:
        async with AsyncSessionLocal() as db:
            todo = [t for t in tickers if not is_crypto(t)] if force else await stale_tickers(db, tickers)
            if not todo:
                return report
            series: dict[str, tuple[int, str]] = {}
            if edgar_service.contact_configured():
                try:
                    await edgar_service.refresh_cik_map(db)
                    series = await _fund_series()
                except Exception as exc:  # noqa: BLE001 - Yahoo's top 10 still works
                    logger.warning("look-through: EDGAR fund list failed: %s", exc)
            by_ticker, by_name = await _company_maps(db)
            for ticker in todo:
                now = datetime.now(timezone.utc)
                await _refresh_ticker(db, ticker, series, by_ticker, by_name, now)
                await db.commit()
                row = await db.get(FundProfile, ticker)
                if row is not None and row.error:
                    report["failed"].append(ticker)
                else:
                    report["refreshed"] += 1
    finally:
        if key:
            running.discard(key)
    return report


async def refresh_all_holdings() -> None:
    """Weekly job: every ticker held in any portfolio."""
    async with AsyncSessionLocal() as db:
        tickers = await edgar_service.held_tickers(db)
    if tickers:
        report = await refresh(tickers)
        logger.info("look-through: refreshed %d tickers, %d failed", report["refreshed"], len(report["failed"]))


async def build_report(db: AsyncSession, portfolio_id: UUID, *, display_currency: str) -> dict:
    """The X-ray of a portfolio (ownership already checked by the caller), from stored fund data."""
    snapshot = (await db.execute(
        select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1)
    )).scalar_one_or_none()
    shares = aggregate_shares(snapshot.holdings) if snapshot else {}
    base = {"display_currency": display_currency, "holdings": len(shares)}
    if not shares:
        return {**base, **lookthrough_calc.xray({}, {}, {}), "no_price": [], "pending": [], "failed": {}, "last_updated_at": None}

    today = datetime.now(timezone.utc).date()
    symbols = sorted(shares)
    closes, _ = await get_closes(db, symbols, history_start(today), today)
    lookups = {s: PriceLookup(c) for s, c in closes.items() if c}
    fx, _ = await fx_factors(db, symbols, display_currency)
    values: dict[str, float] = {}
    for s in symbols:
        px = lookups[s].at(today) if s in lookups else None
        if px is not None:
            values[s] = shares[s] * px * fx.get(s, 1.0)
    total = sum(values.values())
    positions = {s: v / total for s, v in values.items()} if total > 0 else {}

    rows = (await db.execute(select(FundProfile).where(FundProfile.ticker.in_(symbols)))).scalars().all()
    profiles = {r.ticker: {
        "kind": r.kind, "name": r.name, "sector": r.sector, "source": r.source,
        "as_of": r.as_of.isoformat() if r.as_of else None,
        "holdings": r.holdings or [], "sectors": r.sectors or {},
    } for r in rows}
    for s in symbols:
        if is_crypto(s):
            profiles[s] = {"kind": "stock", "name": s, "sector": "Crypto"}

    norm = {s: edgar_service.normalize_ticker(s) for s in symbols}
    cik_rows = (await db.execute(select(SecCik.ticker, SecCik.cik).where(SecCik.ticker.in_(set(norm.values()))))).all()
    ciks = dict(cik_rows)
    keys = {s: f"cik:{ciks[n]}" if n in ciks else f"t:{n}" for s, n in norm.items()}

    report = lookthrough_calc.xray(positions, profiles, keys)
    report["sentences"] = {r["key"]: lookthrough_calc.exposure_sentence(r) for r in report["exposures"]}
    fetched = [r.fetched_at for r in rows if r.fetched_at]
    return {
        **base,
        **report,
        "no_price": [s for s in symbols if s not in values],
        "pending": [s for s in symbols if s not in profiles],
        "failed": {r.ticker: r.error for r in rows if r.error},
        "last_updated_at": max(fetched).isoformat() if fetched else None,
    }
