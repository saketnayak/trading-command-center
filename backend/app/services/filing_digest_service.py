"""Turn stored filings into "what changed" digests.

prepare: 10-K/10-Q → extract the Risk Factors section of the filing and of the
previous filing of the same form (downloaded once, kept in sec_filing_texts),
diff the paragraphs, and store the counts plus the largest changes. 8-K → keep
the text of the report and up to two exhibits (usually the press release).
Either way a deterministic one-line `summary` is stored, so the Filings tab
says something useful without any model.

digest: one LLM call per filing (shared by every user who holds the stock),
with the team's first configured LLM key. Every point must quote the excerpt
it cites (filing_calc.validate_digest); a reply with no cited point is stored
as `uncited` and not shown. Failures are retried on later passes up to
MAX_ATTEMPTS.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.sec_filing import SecFiling, SecFilingText
from app.services import edgar_service, filing_calc

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
MAX_DIGESTS_PER_PASS = 20
MAX_EXHIBITS = 2

# One sync at a time per server; portfolio ids whose refresh is running (for the UI).
_sync_lock = asyncio.Lock()
running: set[str] = set()


async def ask_llm(provider: str, model: str, api_key: str | None, prompt: str) -> str:
    """The single LLM call per digest. The test seam."""
    from app.services.portfolio_insight_runner import _call_llm

    return await _call_llm(provider, model, api_key, prompt)


async def _text(db: AsyncSession, accession: str, section: str) -> list[str] | None:
    row = await db.get(SecFilingText, (accession, section))
    return list(row.paragraphs) if row else None


async def _store_text(db: AsyncSession, accession: str, section: str, paragraphs: list[str]) -> None:
    await db.execute(insert(SecFilingText).values(accession=accession, section=section, paragraphs=paragraphs)
                     .on_conflict_do_update(index_elements=["accession", "section"], set_={"paragraphs": paragraphs}))


async def _risk_factors(db: AsyncSession, f: SecFiling) -> list[str]:
    cached = await _text(db, f.accession, "risk_factors")
    if cached is not None:
        return cached
    html = await edgar_service._http_get(filing_calc.filing_url(f.cik, f.accession, f.primary_doc))
    section = filing_calc.extract_section(filing_calc.html_to_paragraphs(html), "risk_factors")
    await _store_text(db, f.accession, "risk_factors", section)
    return section


_EXHIBIT_SKIP = re.compile(r"^(R\d+\.htm|.*-index.*|.*_htm\.xml)$", re.I)


async def _document(db: AsyncSession, f: SecFiling) -> list[str]:
    cached = await _text(db, f.accession, "document")
    if cached is not None:
        return cached
    base = filing_calc.filing_url(f.cik, f.accession, f.primary_doc).rsplit("/", 1)[0]
    paras = filing_calc.trim_8k(filing_calc.html_to_paragraphs(
        await edgar_service._http_get(f"{base}/{f.primary_doc.rsplit('/', 1)[-1]}")))
    try:
        listing = json.loads(await edgar_service._http_get(f"{base}/index.json"))
        names = [i["name"] for i in listing.get("directory", {}).get("item", [])]
    except Exception as exc:  # noqa: BLE001 - the report itself is enough
        logger.info("sec: no exhibit list for %s: %s", f.accession, exc)
        names = []
    exhibits = [n for n in names if n.lower().endswith((".htm", ".html")) and n != f.primary_doc.rsplit("/", 1)[-1]
                and not _EXHIBIT_SKIP.match(n)][:MAX_EXHIBITS]
    for name in exhibits:
        try:
            exhibit = filing_calc.html_to_paragraphs(await edgar_service._http_get(f"{base}/{name}"))
            paras += ["[Exhibit]"] + exhibit
        except Exception as exc:  # noqa: BLE001
            logger.info("sec: exhibit %s of %s failed: %s", name, f.accession, exc)
    # Keep what the digest can use; signature blocks and boilerplate trail off at the end.
    out, total = [], 0
    for p in paras:
        if total > filing_calc.MAX_DOC_CHARS * 2:
            break
        out.append(p)
        total += len(p)
    await _store_text(db, f.accession, "document", out)
    return out


async def prepare(db: AsyncSession, f: SecFiling) -> None:
    """Extract, diff and summarise without a model; sets digest_status."""
    if f.form in ("10-K", "10-Q"):
        new = await _risk_factors(db, f)
        prev = await db.get(SecFiling, f.prev_accession) if f.prev_accession else None
        prev_info = {"accession": prev.accession, "form": prev.form, "filed_date": prev.filed_date.isoformat()} if prev else None
        if not new:
            f.diff, f.digest_status = {"section_found": False, "prev": prev_info}, "not_applicable"
            f.summary = filing_calc.deterministic_summary(f.form, None, [], prev_info)
            return
        if prev is None:
            f.diff, f.digest_status = {"section_found": True, "prev": None}, "not_applicable"
            f.summary = filing_calc.deterministic_summary(f.form, {}, [], None)
            return
        old = await _risk_factors(db, prev)
        diff = filing_calc.diff_paragraphs(old, new) if old else None
        counts = diff.counts() if diff else None
        changes = filing_calc.changes_for_prompt(diff) if diff else []
        f.diff = {"section_found": True, "prev_section_found": bool(old), "prev": prev_info,
                  "counts": counts, "changes": changes}
        f.summary = filing_calc.deterministic_summary(f.form, counts, [], prev_info) if old else \
            f"The {prev.form} filed {prev.filed_date} has no Risk Factors section to compare with"
        f.digest_status = "prepared" if changes else "not_applicable"
    elif f.form == "8-K":
        doc = await _document(db, f)
        f.summary = filing_calc.deterministic_summary("8-K", None, f.items or [], None)
        f.digest_status = "prepared" if doc else "not_applicable"
    else:
        f.digest_status = "not_applicable"


def _excerpts(f: SecFiling, document: list[str] | None) -> tuple[dict[str, str], str]:
    if f.form == "8-K":
        text = "\n".join(document or [])[:filing_calc.MAX_DOC_CHARS]
        prompt = filing_calc.build_digest_prompt(f.ticker, f.form, f.filed_date.isoformat(), items=f.items or [],
                                                 document=text)
        return {"doc": text}, prompt
    changes = (f.diff or {}).get("changes") or []
    prompt = filing_calc.build_digest_prompt(f.ticker, f.form, f.filed_date.isoformat(), changes=changes,
                                             prev=(f.diff or {}).get("prev"))
    return {c["id"]: c["text"] + " " + (c.get("old") or "") for c in changes}, prompt


async def digest(db: AsyncSession, f: SecFiling, llm: tuple[str, str, str | None]) -> None:
    provider, model, key = llm
    document = await _text(db, f.accession, "document") if f.form == "8-K" else None
    excerpts, prompt = _excerpts(f, document)
    f.digest_attempts += 1
    try:
        raw = await ask_llm(provider, model, key, prompt)
    except Exception as exc:  # noqa: BLE001
        f.digest_error = f"{type(exc).__name__}: {exc}"[:500]
        f.digest_status = "failed" if f.digest_attempts >= MAX_ATTEMPTS else "prepared"
        return
    f.digest_model = f"{provider}/{model}"
    result = filing_calc.validate_digest(raw, excerpts)
    f.digest, f.digest_error = result, None
    f.digest_status = "done" if result else "uncited"


async def _team_llm(db: AsyncSession) -> tuple[str, str, str | None] | None:
    from app.services import llm_selection
    from app.services.llm_provider_registry import is_local_provider
    from app.services.portfolio_insight_runner import _get_api_key

    picked = await llm_selection.pick_llm_for_user(db, None)
    if picked is None:
        return None
    key = await _get_api_key(picked[0], db)
    if not key and not is_local_provider(picked[0]):
        return None
    return picked[0], picked[1], key


async def process(db: AsyncSession, tickers: list[str], *, days: int = edgar_service.WINDOW_DAYS) -> dict:
    """Prepare pending filings, then digest prepared ones, newest first."""
    since = datetime.now(timezone.utc).date() - timedelta(days=days)
    pending = (await db.execute(select(SecFiling).where(
        SecFiling.ticker.in_(tickers or [""]), SecFiling.digest_status == "pending", SecFiling.filed_date >= since)
        .order_by(desc(SecFiling.filed_date)))).scalars().all()
    prepared = prepare_failed = 0
    for f in pending:
        try:
            await prepare(db, f)
            prepared += 1
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            f = await db.get(SecFiling, f.accession)
            f.digest_attempts += 1
            f.digest_error = f"{type(exc).__name__}: {exc}"[:500]
            f.digest_status = "failed" if f.digest_attempts >= MAX_ATTEMPTS else "pending"
            prepare_failed += 1
        await db.commit()

    llm = await _team_llm(db)
    digested = 0
    if llm is not None:
        todo = (await db.execute(select(SecFiling).where(
            SecFiling.ticker.in_(tickers or [""]), SecFiling.digest_status == "prepared", SecFiling.filed_date >= since)
            .order_by(desc(SecFiling.filed_date)).limit(MAX_DIGESTS_PER_PASS))).scalars().all()
        for f in todo:
            await digest(db, f, llm)
            await db.commit()
            digested += f.digest_status == "done"
    return {"prepared": prepared, "prepare_failed": prepare_failed, "digested": digested, "llm": f"{llm[0]}/{llm[1]}" if llm else None}


async def refresh(tickers: list[str], *, force: bool = False, key: str | None = None) -> dict:
    """Sync the tickers' filings and build digests, in its own session. One at a time."""
    if key:
        running.add(key)
    try:
        async with _sync_lock:
            async with AsyncSessionLocal() as db:
                report = await edgar_service.sync_tickers(db, tickers, force=force)
                report.update(await process(db, sorted(set(tickers) - set(report["no_filer"]))))
                return report
    finally:
        if key:
            running.discard(key)


async def refresh_all_holdings() -> None:
    """Nightly job: every ticker held in any portfolio."""
    if not edgar_service.contact_configured():
        logger.info("sec: skipping the nightly refresh; set SEC_USER_AGENT to a name and contact email")
        return
    async with AsyncSessionLocal() as db:
        tickers = await edgar_service.held_tickers(db)
    if not tickers:
        return
    report = await refresh(tickers)
    logger.info("sec: nightly refresh synced %d tickers, %d new filings, %d digests (%d failed tickers)",
                len(report["synced"]), report["new_filings"], report["digested"], len(report["failed"]))


# ── report (read-only, DB only) ──────────────────────────────────────────────

def _filing_dict(f: SecFiling, prev: SecFiling | None) -> dict:
    url = filing_calc.filing_url(f.cik, f.accession, f.primary_doc)
    prev_url = filing_calc.filing_url(prev.cik, prev.accession, prev.primary_doc) if prev else None
    kinds = {c["id"]: c["kind"] for c in (f.diff or {}).get("changes") or []}
    digest = None
    if f.digest_status == "done" and f.digest:
        points = []
        for p in f.digest.get("points") or []:
            kind = kinds.get(p["id"], "document")
            # A removed passage is only in the previous filing, so its link goes there.
            target = prev_url if kind == "removed" and prev_url else url
            points.append({**p, "kind": kind, "link": filing_calc.quote_link(target, p["quote"])})
        digest = {"headline": f.digest.get("headline"), "points": points, "model": f.digest_model}
    return {
        "accession": f.accession, "ticker": f.ticker, "form": f.form,
        "filed_date": f.filed_date.isoformat(), "report_date": f.report_date.isoformat() if f.report_date else None,
        "url": url, "items": filing_calc.item_labels(f.items or []),
        "notable": any(i in filing_calc.NOTABLE_ITEMS for i in (f.items or [])),
        "summary": f.summary, "counts": (f.diff or {}).get("counts"),
        "prev": {"form": prev.form, "filed_date": prev.filed_date.isoformat(), "url": prev_url} if prev else None,
        "digest": digest, "digest_status": f.digest_status,
    }


async def report(db: AsyncSession, tickers: list[str], *, days: int = 90, today=None) -> dict:
    """Filings and insider activity for the tickers over the last `days`. Reads the DB only."""
    from app.models.sec_filing import SecCik, SecInsiderTrade, SecSync

    today = today or datetime.now(timezone.utc).date()
    since = today - timedelta(days=days)
    norm = {t: edgar_service.normalize_ticker(t) for t in tickers}
    cik_rows = {r.ticker: r for r in (await db.execute(select(SecCik).where(SecCik.ticker.in_(set(norm.values()) or {""})))).scalars()}
    covered = sorted(t for t, n in norm.items() if n in cik_rows)
    syncs = {r.ticker: r for r in (await db.execute(select(SecSync).where(SecSync.ticker.in_(covered or [""])))).scalars()}

    rows = (await db.execute(select(SecFiling).where(
        SecFiling.ticker.in_(covered or [""]), SecFiling.form.in_(edgar_service.FORMS),
        SecFiling.digest_status != "reference", SecFiling.filed_date >= since)
        .order_by(desc(SecFiling.filed_date), SecFiling.ticker))).scalars().all()
    prev_ids = {f.prev_accession for f in rows if f.prev_accession}
    prevs = {p.accession: p for p in (await db.execute(select(SecFiling).where(SecFiling.accession.in_(prev_ids or {""})))).scalars()}
    filings = [_filing_dict(f, prevs.get(f.prev_accession)) for f in rows]

    trades = (await db.execute(select(SecInsiderTrade, SecFiling.cik, SecFiling.primary_doc).join(
        SecFiling, SecFiling.accession == SecInsiderTrade.accession).where(
        SecInsiderTrade.ticker.in_(covered or [""]), SecInsiderTrade.trade_date >= since)
        .order_by(desc(SecInsiderTrade.trade_date)))).all()
    by_ticker: dict[str, list] = {}
    for t, cik, doc in trades:
        by_ticker.setdefault(t.ticker, []).append((t, cik, doc))
    insiders = []
    for sym, items in sorted(by_ticker.items()):
        plain = [{"code": t.code, "shares": t.shares, "price": t.price, "planned": t.planned, "owner": t.owner}
                 for t, _, _ in items]
        summary = filing_calc.summarize_insiders(plain)
        if not summary["buys"] and not summary["sells"] and not summary["other_transactions"]:
            continue
        recent = [{
            "date": t.trade_date.isoformat() if t.trade_date else None, "owner": t.owner, "role": t.role,
            "code": t.code, "label": filing_calc.TRADE_CODES.get(t.code, t.code), "shares": t.shares,
            "price": t.price, "value": round(t.shares * t.price, 2) if t.price else None, "planned": t.planned,
            "url": filing_calc.filing_url(cik, t.accession, doc),
        } for t, cik, doc in items if t.code in filing_calc.OPEN_MARKET][:8]
        insiders.append({"ticker": sym, **summary, "recent": recent})
    insiders.sort(key=lambda x: x["buy_value"] + x["sell_value"], reverse=True)

    synced_at = [s.synced_at for t in covered if (s := syncs.get(t))]
    return {
        "days": days,
        "covered": covered,
        "no_filer": sorted(set(tickers) - set(covered)),
        "never_synced": sorted(t for t in covered if t not in syncs),
        "sync_errors": {t: s.error for t, s in syncs.items() if s.error},
        "last_synced_at": min(synced_at).isoformat() if synced_at and len(synced_at) == len(covered) else None,
        "filings": filings,
        "insiders": insiders,
    }
