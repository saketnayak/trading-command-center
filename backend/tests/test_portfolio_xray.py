"""Integration tests for roadmap 3.4: fund lookup and GET/POST /portfolio/{id}/xray.

Yahoo is faked at fund_lookthrough_service._yahoo_profile, EDGAR at edgar_service._http_get and
_http_get_prefix, prices at price_history_service._download_closes. Tickers XR* are unique to this file."""
import asyncio
import json
from datetime import date, timedelta

import pytest

from app.routers import portfolio_xray as router
from app.services import edgar_service, fund_lookthrough_service as service, price_history_service
from tests.test_portfolio_performance import _client, _portfolio, _token

TODAY = date.today()
TRUST = 9100001
SERIES, SIBLING = "S000000911", "S000000912"
NPORT_DOC = f"https://www.sec.gov/Archives/edgar/data/{TRUST}/000000000000000001/primary_doc.xml"
SIBLING_DOC = f"https://www.sec.gov/Archives/edgar/data/{TRUST}/000000000000000002/primary_doc.xml"


def _nport(series: str, report_date: date) -> str:
    return f"""<edgarSubmission xmlns="http://www.sec.gov/edgar/nport"><headerData><filerInfo><seriesClassInfo>
<seriesId>{series}</seriesId></seriesClassInfo></filerInfo></headerData><formData>
<genInfo><repPdDate>{report_date.isoformat()}</repPdDate></genInfo><invstOrSecs>
<invstOrSec><name>XRay Stock Co</name><identifiers><ticker value="XRSTK"/></identifiers><pctVal>40</pctVal><assetCat>EC</assetCat></invstOrSec>
<invstOrSec><name>Another Name Inc</name><identifiers><isin value="US0000000001"/></identifiers><pctVal>35</pctVal><assetCat>EC</assetCat></invstOrSec>
<invstOrSec><name>Cash Sweep</name><pctVal>25</pctVal><assetCat>STIV</assetCat></invstOrSec>
</invstOrSecs></formData></edgarSubmission>"""


YAHOO = {
    "XRSTK": {"kind": "stock", "name": "XRay Stock", "sector": "Technology"},
    "XRFUND": {"kind": "fund", "name": "XRay Fund", "sectors": {"technology": 0.6, "energy": 0.4},
               "top": [{"ticker": "XRSTK", "name": "XRay Stock", "weight": 0.2}, {"ticker": "XROTH", "name": "Other", "weight": 0.1}]},
}


@pytest.fixture
def world(monkeypatch):
    state = {"yahoo": dict(YAHOO), "edgar": {}, "edgar_calls": [], "yahoo_calls": [], "gate": None}

    async def _yahoo(ticker):
        state["yahoo_calls"].append(ticker)
        if state["gate"] is not None:
            await state["gate"].wait()
        got = state["yahoo"].get(ticker)
        if got is None:
            raise ValueError("Yahoo is down")
        return got

    async def _get(url):
        state["edgar_calls"].append(url)
        if url in state["edgar"]:
            return state["edgar"][url]
        raise edgar_service.EdgarError(f"HTTP 404 from {url}")

    async def _prefix(url, size=8192):
        return (await _get(url))[:size]

    async def _closes(symbol, start):
        return {TODAY - timedelta(days=i): 100.0 for i in range(10)}

    monkeypatch.setattr(service, "_yahoo_profile", _yahoo)
    monkeypatch.setattr(edgar_service, "_http_get", _get)
    monkeypatch.setattr(edgar_service, "_http_get_prefix", _prefix)
    monkeypatch.setattr(price_history_service, "_download_closes", _closes)
    monkeypatch.setattr(price_history_service, "RETRY_DELAYS_S", (0.0,))
    monkeypatch.setattr(edgar_service.settings, "sec_user_agent", "AgentFloor tests")  # no contact: Yahoo only
    price_history_service._recent_failures.clear()
    service.running.clear()
    return state


def _with_edgar(world, monkeypatch, report_date: date):
    monkeypatch.setattr(edgar_service.settings, "sec_user_agent", "AgentFloor tests test@example.com")
    subs = {"accessionNumber": ["0000000000-00-000002", "0000000000-00-000001"], "form": ["NPORT-P", "NPORT-P"]}
    world["edgar"].update({
        edgar_service.TICKERS_URL: json.dumps({"0": {"ticker": "XRSTK", "cik_str": 9100002, "title": "XRay Stock Co"},
                                               "1": {"ticker": "XRANO", "cik_str": 9100003, "title": "Another Name Inc"}}),
        service.MF_TICKERS_URL: json.dumps({"fields": ["cik", "seriesId", "classId", "symbol"],
                                            "data": [[TRUST, SERIES, "C1", "XRFUND"]]}),
        edgar_service.SUBMISSIONS_URL.format(cik=TRUST): json.dumps({"filings": {"recent": subs}}),
        SIBLING_DOC: _nport(SIBLING, report_date),
        NPORT_DOC: _nport(SERIES, report_date),
    })


async def _settle():
    if router._tasks:
        await asyncio.gather(*router._tasks)


async def _xray(c, h, pid):
    r = await c.get(f"/portfolio/{pid}/xray", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def test_first_visit_looks_up_then_shows_top_10_with_honest_coverage(world):
    async with _client() as c:
        h = await _token(c, "xr1@example.com")
        pid = await _portfolio(c, h, [(1, {"XRSTK": 1, "XRFUND": 1})])
        world["gate"] = asyncio.Event()  # hold the lookup so the first response is predictable
        first = await _xray(c, h, pid)
        assert first["syncing"] is True and sorted(first["pending"]) == ["XRFUND", "XRSTK"]
        world["gate"].set()
        await _settle()

        out = await _xray(c, h, pid)
    assert out["syncing"] is False and out["pending"] == [] and out["full_holdings_available"] is False
    fund = out["funds"][0]
    assert fund["source"] == "yahoo_top10" and fund["covered_weight"] == pytest.approx(0.3)
    top = out["exposures"][0]
    # Half the portfolio directly, plus 20% of the half in the fund.
    assert top["ticker"] == "XRSTK" and top["total"] == pytest.approx(0.6)
    assert out["sentences"][top["key"]] == "You hold 60.0% XRSTK: 50.0% directly and 10.0% through 1 fund."
    assert out["uncovered_weight"] == pytest.approx(0.35)
    assert out["concentration"]["look_through"]["top1_weight"] == pytest.approx(0.6)
    assert {s["sector"]: s["total"] for s in out["sectors"]}["Technology"] == pytest.approx(0.8)
    assert world["edgar_calls"] == []  # no contact, no EDGAR


async def test_with_a_contact_nport_gives_full_holdings_and_skips_sibling_funds(world, monkeypatch):
    _with_edgar(world, monkeypatch, TODAY - timedelta(days=60))
    async with _client() as c:
        h = await _token(c, "xr2@example.com")
        pid = await _portfolio(c, h, [(1, {"XRSTK": 1, "XRFUND": 1})])
        await _xray(c, h, pid)
        await _settle()
        out = await _xray(c, h, pid)
    fund = out["funds"][0]
    assert fund["source"] == "sec_nport" and fund["covered_weight"] == pytest.approx(0.75)
    assert fund["as_of"] == (TODAY - timedelta(days=60)).isoformat()
    by_ticker = {r["ticker"]: r for r in out["exposures"]}
    assert by_ticker["XRSTK"]["total"] == pytest.approx(0.7)  # the fund's stock met the direct holding by CIK
    assert by_ticker["XRANO"]["total"] == pytest.approx(0.175)  # matched by name, no ticker in the filing
    assert world["edgar_calls"].count(SIBLING_DOC) == 1  # only the opening bytes of the sibling's filing


async def test_an_old_nport_falls_back_to_yahoo(world, monkeypatch):
    _with_edgar(world, monkeypatch, TODAY - timedelta(days=service.MAX_NPORT_AGE_DAYS + 5))
    async with _client() as c:
        h = await _token(c, "xr3@example.com")
        pid = await _portfolio(c, h, [(1, {"XRFUND": 1})])
        await service.refresh(["XRFUND"], force=True)
        out = await _xray(c, h, pid)
    assert out["funds"][0]["source"] == "yahoo_top10"


async def test_a_failed_refresh_keeps_good_data_and_says_so(world):
    async with _client() as c:
        h = await _token(c, "xr4@example.com")
        pid = await _portfolio(c, h, [(1, {"XRFUND": 1})])
        await service.refresh(["XRFUND"], force=True)
        world["yahoo"].pop("XRFUND")
        report = await service.refresh(["XRFUND"], force=True)
        out = await _xray(c, h, pid)
    assert report["failed"] == ["XRFUND"]
    assert out["funds"][0]["holdings_known"] == 2 and "Yahoo" in out["failed"]["XRFUND"]


async def test_fresh_data_is_not_fetched_again_but_post_forces_it(world):
    async with _client() as c, _client() as other:
        h = await _token(c, "xr5@example.com")
        oh = await _token(other, "xr6@example.com")
        pid = await _portfolio(c, h, [(1, {"XRFUND": 1})])
        await service.refresh(["XRFUND"], force=True)
        calls = len(world["yahoo_calls"])
        assert (await _xray(c, h, pid))["syncing"] is False
        await _settle()
        assert len(world["yahoo_calls"]) == calls

        r = await c.post(f"/portfolio/{pid}/xray/refresh", headers=h)
        assert r.status_code == 202
        await _settle()
        assert len(world["yahoo_calls"]) == calls + 1

        assert (await other.get(f"/portfolio/{pid}/xray", headers=oh)).status_code == 404
        assert (await other.post(f"/portfolio/{pid}/xray/refresh", headers=oh)).status_code == 404


async def test_stocks_and_crypto_have_no_funds_and_crypto_never_reaches_yahoo(world):
    async with _client() as c:
        h = await _token(c, "xr7@example.com")
        pid = await _portfolio(c, h, [(1, {"XRSTK": 1, "BTC-USD": 1})])
        await _xray(c, h, pid)
        await _settle()
        out = await _xray(c, h, pid)
    assert out["funds"] == [] and out["uncovered_weight"] == 0
    assert "BTC-USD" not in world["yahoo_calls"]
    assert {s["sector"] for s in out["sectors"]} == {"Technology", "Crypto"}
