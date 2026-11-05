"""Integration tests for roadmap 3.3: EDGAR sync, digests and GET/POST /portfolio/{id}/filings.

EDGAR is faked at edgar_service._http_get (URL → response) and the LLM at
filing_digest_service.ask_llm. Tickers SECA–SECE are unique to this file."""
import asyncio
import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.sec_filing import SecFiling, SecInsiderTrade
from app.routers import filings as filings_router
from app.services import edgar_service, filing_digest_service as fds
from tests.test_filing_calc import COMPETE_NEW, COMPETE_OLD, EXPORT, SUPPLY, TARIFF, ten_k
from tests.test_portfolio_performance import _client, _portfolio, _token

FIX = Path(__file__).parent / "fixtures" / "sec"
TODAY = date.today()
ARCH = "https://www.sec.gov/Archives/edgar/data"

CIKS = {"SECA": 9000001, "SECB": 9000002, "SECC": 9000003, "SECD": 9000004, "SECE": 9000005}


def _day(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()


def _subs(rows: list[tuple[str, str, int, str, str]]) -> str:
    """rows: (accession, form, days_ago, primary_doc, items)"""
    cols = {"accessionNumber": [], "form": [], "filingDate": [], "reportDate": [], "primaryDocument": [], "items": []}
    for acc, form, ago, doc, items in rows:
        for k, v in zip(cols, (acc, form, _day(ago), "", doc, items)):
            cols[k].append(v)
    return json.dumps({"filings": {"recent": cols}})


def _acc_dir(cik: int, acc: str) -> str:
    return f"{ARCH}/{cik}/{acc.replace('-', '')}"


EIGHT_K = "<html><body><p>Item 5.02 Departure of Directors</p><p>On the date above, Jane Doe resigned as Chief Financial Officer of the Company, effective at the end of the quarter.</p></body></html>"
EXHIBIT = "<html><body><p>SEC Alpha names John Smith interim CFO while a search for a permanent successor is under way.</p></body></html>"


def _edgar() -> dict[str, str]:
    a, c, d, e = CIKS["SECA"], CIKS["SECC"], CIKS["SECD"], CIKS["SECE"]
    return {
        edgar_service.TICKERS_URL: json.dumps({str(i): {"cik_str": cik, "ticker": t, "title": f"{t} Corp"}
                                               for i, (t, cik) in enumerate(CIKS.items())}),
        edgar_service.SUBMISSIONS_URL.format(cik=a): _subs([
            ("0009000001-26-000004", "4", 12, "xslF345X06/other.xml", ""),
            ("0009000001-26-000003", "4", 15, "xslF345X06/buy.xml", ""),
            ("0009000001-26-000002", "8-K", 10, "seca-8k.htm", "5.02,9.01"),
            ("0009000001-26-000001", "10-K", 20, "seca-10k-new.htm", ""),
            ("0009000001-26-000005", "4", 30, "xslF345X06/sale.xml", ""),
            ("0009000001-25-000001", "10-K", 385, "seca-10k-old.htm", ""),
        ]),
        f"{_acc_dir(a, '0009000001-26-000001')}/seca-10k-new.htm": ten_k([EXPORT.format(2026), COMPETE_NEW, TARIFF]),
        f"{_acc_dir(a, '0009000001-25-000001')}/seca-10k-old.htm": ten_k([EXPORT.format(2025), SUPPLY, COMPETE_OLD]),
        f"{_acc_dir(a, '0009000001-26-000002')}/seca-8k.htm": EIGHT_K,
        f"{_acc_dir(a, '0009000001-26-000002')}/index.json": json.dumps({"directory": {"item": [
            {"name": "seca-8k.htm"}, {"name": "R1.htm"}, {"name": "ex99.htm"}, {"name": "0009000001-26-000002-index.html"}]}}),
        f"{_acc_dir(a, '0009000001-26-000002')}/ex99.htm": EXHIBIT,
        # Trade dates follow today, so the windows hold whenever the tests run.
        f"{_acc_dir(a, '0009000001-26-000005')}/sale.xml": (FIX / "form4_sale.xml").read_text().replace("2026-10-01", _day(25)),
        f"{_acc_dir(a, '0009000001-26-000003')}/buy.xml": (FIX / "form4_buy.xml").read_text().replace("2026-10-20", _day(15)),
        f"{_acc_dir(a, '0009000001-26-000004')}/other.xml": (FIX / "form4_other_issuer.xml").read_text(),
        # SECB: its submissions request fails.
        edgar_service.SUBMISSIONS_URL.format(cik=c): _subs([("0009000003-26-000001", "8-K", 5, "secc.htm", "2.02")]),
        f"{_acc_dir(c, '0009000003-26-000001')}/secc.htm": "<p>Quarterly results were released today in the attached press release.</p>",
        edgar_service.SUBMISSIONS_URL.format(cik=d): _subs([("0009000004-26-000001", "8-K", 3, "secd.htm", "8.01")]),
        f"{_acc_dir(d, '0009000004-26-000001')}/secd.htm": "<p>The company announced a special dividend payable next month to holders of record.</p>",
        edgar_service.SUBMISSIONS_URL.format(cik=e): _subs([("0009000005-26-000001", "8-K", 2, "sece.htm", "7.01")]),
        f"{_acc_dir(e, '0009000005-26-000001')}/sece.htm": "<p>The company presented at an industry conference and posted the slides online.</p>",
    }


@pytest.fixture
def edgar(monkeypatch):
    pages, calls = _edgar(), []

    async def _get(url: str) -> str:
        calls.append(url)
        if url in pages:
            return pages[url]
        raise edgar_service.EdgarError(f"HTTP 404 from {url}")

    monkeypatch.setattr(edgar_service, "_http_get", _get)
    return calls


def _first_excerpt(prompt: str) -> dict:
    body = prompt.split("Excerpts (JSON):\n", 1)[1].split("\n\n", 1)[0]
    return json.loads(body)[0]


@pytest.fixture
def llm(monkeypatch):
    state = {"pick": ("openai", "gpt-4o-mini"), "mode": "cite", "prompts": []}

    async def _pick(db, user):
        return state["pick"]

    async def _key(provider, db):
        return "sk-test"

    async def _ask(provider, model, key, prompt):
        state["prompts"].append(prompt)
        ex = _first_excerpt(prompt)
        quote = " ".join(ex["text"].split()[:8])
        if state["mode"] == "uncited":
            quote = "words that appear nowhere in the filing at all"
        return json.dumps({"headline": f"Headline for {ex['id']}", "points": [
            {"id": ex["id"], "text": "The main change.", "quote": quote},
            {"id": ex["id"], "text": "An invented claim.", "quote": "revenue fell by ninety percent last quarter"}]})

    import app.services.llm_selection as llm_selection
    import app.services.portfolio_insight_runner as pir
    monkeypatch.setattr(llm_selection, "pick_llm_for_user", _pick)
    monkeypatch.setattr(pir, "_get_api_key", _key)
    monkeypatch.setattr(fds, "ask_llm", _ask)
    return state


async def test_refresh_stores_filings_insiders_and_cited_digests(edgar, llm):
    report = await fds.refresh(["SECA", "SECB", "BTC-USD"])
    assert report["synced"] == ["SECA"] and list(report["failed"]) == ["SECB"] and report["no_filer"] == ["BTC-USD"]
    assert report["new_filings"] == 2 and report["digested"] == 2 and report["llm"] == "openai/gpt-4o-mini"

    async with AsyncSessionLocal() as db:
        ten_k_row = await db.get(SecFiling, "0009000001-26-000001")
        assert ten_k_row.diff["counts"] == {"added": 1, "removed": 1, "reworded": 1, "unchanged": 1}
        assert ten_k_row.prev_accession == "0009000001-25-000001"
        assert (await db.get(SecFiling, "0009000001-25-000001")).digest_status == "reference"
        trades = (await db.execute(select(SecInsiderTrade).where(SecInsiderTrade.ticker == "SECA"))).scalars().all()
        assert sorted(t.code for t in trades) == ["F", "P", "S"]  # the other issuer's Form 4 is not SECA's

    async with _client() as c:
        h = await _token(c, "sec1@example.com")
        pid = await _portfolio(c, h, [(1, {"SECA": 10, "SECB": 5, "BTC-USD": 1})])
        out = (await c.get(f"/portfolio/{pid}/filings", headers=h)).json()
    assert out["covered"] == ["SECA", "SECB"] and out["no_filer"] == ["BTC-USD"] and out["never_synced"] == []
    assert out["syncing"] is False and out["llm_available"] is True and out["holdings"] == 3
    assert list(out["sync_errors"]) == ["SECB"]

    forms = [(f["ticker"], f["form"]) for f in out["filings"]]
    assert forms == [("SECA", "8-K"), ("SECA", "10-K")]  # newest first; the reference 10-K is not listed
    eight_k, ten_k_f = out["filings"]
    assert eight_k["notable"] is True and [i["label"] for i in eight_k["items"]] == ["Director or officer change, or pay arrangement"]
    assert eight_k["summary"] == "Director or officer change, or pay arrangement"
    assert eight_k["digest"]["points"][0]["kind"] == "document"

    assert ten_k_f["summary"].startswith("Risk factors vs the 10-K filed ")
    assert ten_k_f["prev"]["url"].endswith("/seca-10k-old.htm")
    d = ten_k_f["digest"]
    assert d["model"] == "openai/gpt-4o-mini" and len(d["points"]) == 1  # the invented claim was dropped
    point = d["points"][0]
    assert "#:~:text=" in point["link"]
    expected_doc = "seca-10k-old.htm" if point["kind"] == "removed" else "seca-10k-new.htm"
    assert expected_doc in point["link"]  # a removed passage links to the previous filing

    (ins,) = out["insiders"]
    assert ins["ticker"] == "SECA" and (ins["buys"], ins["sells"], ins["planned_sells"]) == (1, 1, 1)
    assert ins["other_transactions"] == 1 and ins["net_value"] == 29500.0
    assert [r["code"] for r in ins["recent"]] == ["P", "S"] and ins["recent"][1]["value"] == 50500.0
    assert ins["recent"][0]["url"].endswith("/buy.xml")

    # The prompt for the 8-K included the exhibit (the press release).
    assert any("interim CFO" in p for p in llm["prompts"])

    # A second refresh within 6 h fetches nothing again.
    before = len(edgar)
    again = await fds.refresh(["SECA"])
    assert again["fresh"] == ["SECA"] and len(edgar) == before


async def test_without_an_llm_filings_still_get_plain_summaries(edgar, llm):
    llm["pick"] = None
    report = await fds.refresh(["SECC"])
    assert report["llm"] is None and report["digested"] == 0
    async with _client() as c:
        h = await _token(c, "sec2@example.com")
        pid = await _portfolio(c, h, [(1, {"SECC": 1})])
        out = (await c.get(f"/portfolio/{pid}/filings", headers=h)).json()
    (f,) = out["filings"]
    assert out["llm_available"] is False and f["digest"] is None and f["digest_status"] == "prepared"
    assert f["summary"] == "Results of operations"

    # Once a key exists, the next pass digests what was prepared.
    llm["pick"] = ("openai", "gpt-4o-mini")
    async with AsyncSessionLocal() as db:
        assert (await fds.process(db, ["SECC"]))["digested"] == 1


async def test_an_uncited_reply_is_never_shown(edgar, llm):
    llm["mode"] = "uncited"
    await fds.refresh(["SECD"])
    async with AsyncSessionLocal() as db:
        row = await db.get(SecFiling, "0009000004-26-000001")
        assert row.digest_status == "uncited" and row.digest is None
        report = await fds.report(db, ["SECD"])
    assert report["filings"][0]["digest"] is None and report["filings"][0]["summary"] == "Other events"


async def test_get_starts_a_background_refresh_and_post_forces_one(edgar, llm):
    async with _client() as c, _client() as other:
        h = await _token(c, "sec3@example.com")
        oh = await _token(other, "sec4@example.com")
        pid = await _portfolio(c, h, [(1, {"SECE": 3})])
        first = (await c.get(f"/portfolio/{pid}/filings", headers=h)).json()
        assert first["syncing"] is True and first["filings"] == []
        await asyncio.gather(*filings_router._tasks)
        done = (await c.get(f"/portfolio/{pid}/filings", headers=h)).json()
        assert done["syncing"] is False and [f["ticker"] for f in done["filings"]] == ["SECE"]
        assert done["last_synced_at"] is not None

        r = await c.post(f"/portfolio/{pid}/filings/refresh", headers=h)
        assert r.status_code == 202 and r.json()["syncing"] is True
        await asyncio.gather(*filings_router._tasks)

        assert (await other.get(f"/portfolio/{pid}/filings", headers=oh)).status_code == 404
        assert (await other.post(f"/portfolio/{pid}/filings/refresh", headers=oh)).status_code == 404
        empty = (await c.post("/portfolio", json={"name": "Empty"}, headers=h)).json()["id"]
        assert (await c.post(f"/portfolio/{empty}/filings/refresh", headers=h)).status_code == 422
        assert (await c.get(f"/portfolio/{empty}/filings", headers=h)).json()["filings"] == []


async def test_insight_prompt_gets_the_filings_block(edgar, llm):
    from app.services.portfolio_insight_runner import _filings_block

    await fds.refresh(["SECA"])
    async with _client() as c:
        h = await _token(c, "sec5@example.com")
        pid = await _portfolio(c, h, [(1, {"SECA": 1})])
    block = await _filings_block(pid)
    assert "RECENT SEC FILINGS AND INSIDER TRADES (last 30 days" in block
    assert "SECA 8-K filed" in block and "SECA 10-K filed" in block
    assert "SECA insiders: 1 open-market buys ($80k), 1 sells ($50k), 1 under 10b5-1 plans" in block
    assert "invented claim" not in block
