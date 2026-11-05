"""SEC EDGAR client and filing store (sec_ciks, sec_filings, sec_insider_trades, sec_sync).

EDGAR is free and keyless but asks every client to send a descriptive
User-Agent (`settings.sec_user_agent`) and to stay under 10 requests a second;
all requests here go through one limiter at about 6 a second, with retry
back-off on 429/5xx. A ticker's filing list is fresh for 6 hours.

What is stored per held ticker: 10-K, 10-Q and 8-K filings from the last
WINDOW_DAYS (plus the previous 10-K/10-Q each one is compared against), and
Form 4 insider trades from the last FORM4_DAYS. Text extraction, diffs and
digests live in filing_digest_service / filing_calc.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import delete, desc, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.sec_filing import SecCik, SecFiling, SecInsiderTrade, SecSync
from app.services import filing_calc

logger = logging.getLogger(__name__)

FORMS = ("10-K", "10-Q", "8-K")
WINDOW_DAYS = 120
FORM4_DAYS = 90
MAX_FORM4_PER_TICKER = 25
FRESH_FOR = timedelta(hours=6)
CIK_FRESH_FOR = timedelta(days=7)
RETRY_DELAYS_S: tuple[float, ...] = (1.0, 3.0)
MIN_INTERVAL_S = 0.16

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"

_client = httpx.AsyncClient(timeout=30.0, follow_redirects=True)
_rate_lock = asyncio.Lock()
_last_request = 0.0


class EdgarError(RuntimeError):
    pass


def contact_configured() -> bool:
    """EDGAR answers 403 to a User-Agent without a contact email, so don't call it without one."""
    return "@" in settings.sec_user_agent


async def _http_get(url: str) -> str:
    """One GET to EDGAR, rate-limited and retried. The test seam."""
    global _last_request
    for attempt in range(len(RETRY_DELAYS_S) + 1):
        async with _rate_lock:
            wait = MIN_INTERVAL_S - (time.monotonic() - _last_request)
            if wait > 0:
                await asyncio.sleep(wait)
            _last_request = time.monotonic()
        try:
            resp = await _client.get(url, headers={"User-Agent": settings.sec_user_agent,
                                                   "Accept-Encoding": "gzip, deflate"})
        except httpx.HTTPError as exc:
            err: Exception = exc
        else:
            if resp.status_code == 200:
                return resp.text
            err = EdgarError(f"HTTP {resp.status_code} from {url}")
            if resp.status_code not in (429, 500, 502, 503, 504):
                raise err
        if attempt < len(RETRY_DELAYS_S):
            await asyncio.sleep(RETRY_DELAYS_S[attempt])
    raise EdgarError(str(err))


async def _http_get_prefix(url: str, size: int = 8192) -> str:
    """The first bytes of a document, without downloading the rest. A test seam."""
    global _last_request
    async with _rate_lock:
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_request)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request = time.monotonic()
    async with _client.stream("GET", url, headers={"User-Agent": settings.sec_user_agent}) as resp:
        if resp.status_code != 200:
            raise EdgarError(f"HTTP {resp.status_code} from {url}")
        chunks: list[bytes] = []
        got = 0
        async for chunk in resp.aiter_bytes():
            chunks.append(chunk)
            got += len(chunk)
            if got >= size:
                break
    return b"".join(chunks).decode("utf-8", "ignore")


def normalize_ticker(t: str) -> str:
    return t.strip().upper().replace(".", "-")


# ── ticker → CIK ─────────────────────────────────────────────────────────────

async def refresh_cik_map(db: AsyncSession, *, force: bool = False) -> int:
    newest = (await db.execute(select(SecCik.updated_at).order_by(desc(SecCik.updated_at)).limit(1))).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if not force and newest is not None and now - newest < CIK_FRESH_FOR:
        return 0
    data = json.loads(await _http_get(TICKERS_URL))
    rows: dict[str, dict] = {}
    for entry in data.values():
        t = normalize_ticker(str(entry.get("ticker") or ""))
        if t and t not in rows:  # the file lists a company's main ticker first
            rows[t] = {"ticker": t, "cik": int(entry["cik_str"]), "name": str(entry.get("title") or "")[:256],
                       "updated_at": now}
    await db.execute(delete(SecCik))
    values = list(rows.values())
    for i in range(0, len(values), 2000):
        await db.execute(insert(SecCik).values(values[i:i + 2000]))
    await db.commit()
    return len(values)


async def ciks_for(db: AsyncSession, tickers: list[str]) -> dict[str, SecCik]:
    """Ticker (as held) → its SEC registrant. Tickers without one (ETFs, crypto, foreign) are absent."""
    try:
        await refresh_cik_map(db)
    except Exception as exc:  # noqa: BLE001 - an old map is better than none
        logger.warning("sec: CIK map refresh failed: %s", exc)
    norm = {t: normalize_ticker(t) for t in tickers}
    rows = (await db.execute(select(SecCik).where(SecCik.ticker.in_(set(norm.values()))))).scalars().all()
    by = {r.ticker: r for r in rows}
    return {t: by[n] for t, n in norm.items() if n in by}


# ── holdings ─────────────────────────────────────────────────────────────────

async def held_tickers(db: AsyncSession, portfolio_id=None) -> list[str]:
    """Tickers in the latest snapshot of one portfolio, or of every portfolio."""
    from app.services.portfolio_pricing import aggregate_shares

    ids = [portfolio_id] if portfolio_id else (await db.execute(select(Portfolio.id))).scalars().all()
    out: set[str] = set()
    for pid in ids:
        snap = (await db.execute(
            select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == pid)
            .options(selectinload(PortfolioSnapshot.holdings))
            .order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1)
        )).scalar_one_or_none()
        if snap:
            out |= set(aggregate_shares(snap.holdings))
    return sorted(out)


# ── filings ──────────────────────────────────────────────────────────────────

def _d(s: str | None) -> date | None:
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


def recent_filings(submissions: dict) -> list[dict]:
    """The `filings.recent` columns as rows, newest first."""
    r = (submissions.get("filings") or {}).get("recent") or {}
    n = len(r.get("accessionNumber") or [])
    col = lambda k: r.get(k) or [None] * n  # noqa: E731
    acc, form, filed, rep, doc, items = (col(k) for k in (
        "accessionNumber", "form", "filingDate", "reportDate", "primaryDocument", "items"))
    rows = [{"accession": acc[i], "form": form[i], "filed": _d(filed[i]), "report": _d(rep[i]),
             "doc": doc[i] or "", "items": filing_calc.parse_items(items[i])} for i in range(n)]
    return sorted((x for x in rows if x["filed"] and x["accession"]), key=lambda x: x["filed"], reverse=True)


def plan_filings(rows: list[dict], today: date) -> tuple[list[dict], list[dict]]:
    """(filings to keep, Form 4s to parse). Each 10-K/10-Q gets `prev`, the previous
    filing of the same form, which may be older than the window."""
    keep: list[dict] = []
    for i, x in enumerate(rows):
        if x["form"] not in FORMS or not filing_calc.is_recent(x["filed"], today, WINDOW_DAYS):
            continue
        x = dict(x)
        if x["form"] in ("10-K", "10-Q"):
            x["prev"] = next((y for y in rows[i + 1:] if y["form"] == x["form"]), None)
        keep.append(x)
    form4 = [x for x in rows if x["form"] == "4" and filing_calc.is_recent(x["filed"], today, FORM4_DAYS)]
    return keep, form4[:MAX_FORM4_PER_TICKER]


async def _upsert_filing(db: AsyncSession, ticker: str, cik: int, x: dict, *, status: str = "pending",
                         prev: str | None = None) -> bool:
    """Insert if new; returns True when inserted."""
    stmt = insert(SecFiling).values(
        accession=x["accession"], cik=cik, ticker=ticker, form=x["form"], filed_date=x["filed"],
        report_date=x["report"], primary_doc=x["doc"], items=x["items"], prev_accession=prev,
        digest_status=status, digest_attempts=0,
    ).on_conflict_do_nothing(index_elements=["accession"])
    return bool((await db.execute(stmt)).rowcount)


async def _store_form4(db: AsyncSession, ticker: str, cik: int, x: dict) -> None:
    xml = await _http_get(filing_calc.filing_url(cik, x["accession"], x["doc"]))
    parsed = filing_calc.parse_form4(xml)
    await _upsert_filing(db, ticker, cik, x, status="not_applicable")
    # The issuer's submissions also list Form 4s it filed as an owner of another company.
    issuer = parsed.get("ticker")
    if issuer and normalize_ticker(issuer) != normalize_ticker(ticker):
        return
    for t in parsed["trades"]:
        await db.execute(insert(SecInsiderTrade).values(
            accession=x["accession"], seq=t["seq"], ticker=ticker, owner=(parsed["owner"] or "")[:256] or None,
            role=(parsed["role"] or "")[:256] or None, trade_date=_d(t["date"]), code=t["code"][:4],
            shares=t["shares"], price=t["price"], acquired=t["acquired"], post_shares=t["post_shares"],
            direct=t["direct"], planned=parsed["planned"],
        ).on_conflict_do_nothing(index_elements=["accession", "seq"]))


async def sync_ticker(db: AsyncSession, ticker: str, cik: int, today: date | None = None) -> int:
    """Fetch the ticker's filing list and store what is new. Returns new filings (not Form 4s)."""
    today = today or datetime.now(timezone.utc).date()
    rows = recent_filings(json.loads(await _http_get(SUBMISSIONS_URL.format(cik=cik))))
    keep, form4 = plan_filings(rows, today)
    new = 0
    for x in keep:
        prev = x.get("prev")
        if prev and not filing_calc.is_recent(prev["filed"], today, WINDOW_DAYS):
            await _upsert_filing(db, ticker, cik, prev, status="reference")
        new += await _upsert_filing(db, ticker, cik, x, prev=prev["accession"] if prev else None)
    known = set((await db.execute(select(SecFiling.accession).where(
        SecFiling.accession.in_([x["accession"] for x in form4] or [""])))).scalars())
    for x in form4:
        if x["accession"] in known:
            continue
        try:
            await _store_form4(db, ticker, cik, x)
        except Exception as exc:  # noqa: BLE001 - one bad Form 4 must not lose the rest
            logger.info("sec: Form 4 %s for %s failed: %s", x["accession"], ticker, exc)
    await db.commit()
    return new


async def sync_tickers(db: AsyncSession, tickers: list[str], *, force: bool = False) -> dict:
    """Sync every stale ticker that has an SEC registrant. Returns a report."""
    now = datetime.now(timezone.utc)
    ciks = await ciks_for(db, tickers)
    synced = {r.ticker: r for r in (await db.execute(select(SecSync).where(SecSync.ticker.in_(list(ciks) or [""])))).scalars()}
    report = {"synced": [], "fresh": [], "failed": {}, "no_filer": sorted(set(tickers) - set(ciks)), "new_filings": 0}
    for t, row in sorted(ciks.items()):
        s = synced.get(t)
        if not force and s and s.error is None and now - s.synced_at < FRESH_FOR:
            report["fresh"].append(t)
            continue
        try:
            report["new_filings"] += await sync_ticker(db, t, row.cik)
            error = None
            report["synced"].append(t)
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            error = f"{type(exc).__name__}: {exc}"[:500]
            report["failed"][t] = error
            logger.warning("sec: sync failed for %s: %s", t, error)
        at = datetime.now(timezone.utc)
        await db.execute(insert(SecSync).values(ticker=t, synced_at=at, error=error).on_conflict_do_update(
            index_elements=["ticker"], set_={"synced_at": at, "error": error}))
        await db.commit()
    return report
