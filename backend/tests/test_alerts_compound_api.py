"""Integration tests for roadmap 3.2: compound rules through the engine, the
"re-run the analysis" action, and POST /alerts/compile with a faked LLM.

Quotes, regimes, moving averages and sectors are scripted through a MarketData
subclass; holdings, verdicts and weights go through the real DB paths. Tickers
are unique to this file (NL*) except AAA/BBB, which the fake price store knows."""
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models.alert import AlertEvent, AlertRule
from app.models.run import Run, RunStatus, RunVerdict
from app.services import alert_compiler, alert_engine
from tests.test_alerts_api import _user_id
from tests.test_portfolio_performance import _client, _portfolio, _token, fake_prices  # noqa: F401

QUOTES: dict[str, dict] = {}
REGIMES: dict[str, str] = {}
MAS: dict[tuple[str, int], dict] = {}
SECTORS: dict[str, tuple[str | None, str | None]] = {}
FETCHED: list[tuple[str, str]] = []


class ScriptedData(alert_engine.MarketData):
    async def quote(self, ticker):
        FETCHED.append(("quote", ticker))
        return QUOTES.get(ticker)

    async def regime(self, ticker):
        FETCHED.append(("regime", ticker))
        return {"regime": REGIMES[ticker]} if ticker in REGIMES else None

    async def moving_average(self, ticker, window):
        FETCHED.append((f"ma{window}", ticker))
        return MAS.get((ticker, window))

    async def sectors(self, tickers):
        return {t: SECTORS.get(t, (None, None)) for t in tickers}


@pytest.fixture(autouse=True)
def _reset():
    for d in (QUOTES, REGIMES, MAS, SECTORS):
        d.clear()
    FETCHED.clear()


async def _run_pass():
    return await alert_engine.evaluate_all_alerts(data_factory=ScriptedData)


SEMIS_BEAR_BELOW_200 = {
    "op": "and", "scope": "holdings", "sectors": ["semiconductor"],
    "conditions": [{"type": "regime", "regime": "Bear"}, {"type": "ma", "window": 200, "direction": "below"}],
}


async def test_holdings_rule_with_sector_scope_fires_per_ticker(monkeypatch):
    monkeypatch.setattr(alert_engine, "MarketData", ScriptedData)  # check_rule's default data source
    async with _client() as c:
        h = await _token(c, "nl1@example.com")
        pid = await _portfolio(c, h, [(1, {"NLSEMA": 10, "NLSEMB": 5, "NLPHRM": 3})])
        SECTORS.update({"NLSEMA": ("Technology", "Semiconductors"), "NLSEMB": ("Technology", "Semiconductors"),
                        "NLPHRM": ("Healthcare", "Drug Manufacturers")})
        r = await c.post("/alerts/rules", json={"kind": "compound", "portfolio_id": pid, "params": SEMIS_BEAR_BELOW_200,
                                                 "cooldown_hours": 0}, headers=h)
        assert r.status_code == 201, r.text
        rule = r.json()
        assert rule["ticker"] is None and rule["portfolio_id"] == pid and rule["rerun_analysis"] is False

        REGIMES.update({"NLSEMA": "Bear", "NLSEMB": "Bull", "NLPHRM": "Bear"})
        MAS.update({("NLSEMA", 200): {"close": 90, "sma": 100}, ("NLSEMB", 200): {"close": 90, "sma": 100},
                    ("NLPHRM", 200): {"close": 50, "sma": 60}})
        assert (await _run_pass())["fired"] == 1
        # The pharma holding is outside the sector filter, so nothing was fetched for it.
        assert not [f for f in FETCHED if f[1] == "NLPHRM"]
        ev = (await c.get("/alerts/events", headers=h)).json()[0]
        assert ev["kind"] == "compound" and ev["title"] == "NLSEMA: Bear regime and below its 200-day average"
        assert ev["data"]["matched"] == ["NLSEMA"] and ev["analyses"] == []
        assert "semiconductor holdings in Perf" in ev["message"]

        assert (await _run_pass())["fired"] == 0  # still matching: quiet
        REGIMES["NLSEMB"] = "Bear"
        assert (await _run_pass())["fired"] == 1
        ev = (await c.get("/alerts/events", headers=h)).json()[0]
        assert ev["data"]["matched"] == ["NLSEMB"]

        check = (await c.post(f"/alerts/rules/{rule['id']}/check", headers=h)).json()
        assert check["condition"] is True and check["would_fire"] is False
        assert check["observed"] == "2 of 2 holdings match: NLSEMA, NLSEMB; 1 holding outside the sector filter"
        assert check["note"].startswith("Fires for each holding")


async def test_and_rule_skips_costly_readings_once_decided():
    async with _client() as c:
        h = await _token(c, "nl2@example.com")
        await c.post("/alerts/rules", json={"kind": "compound", "ticker": "nlskip", "params": {
            "conditions": [{"type": "regime", "regime": "Bear"}, {"type": "daily_move", "pct": 4, "direction": "down"}]},
        }, headers=h)
        QUOTES["NLSKIP"] = {"price": 10.0, "change_pct": 1.0, "prev_close": 9.9}
        REGIMES["NLSKIP"] = "Bear"
        assert (await _run_pass())["fired"] == 0
        assert ("quote", "NLSKIP") in FETCHED and ("regime", "NLSKIP") not in FETCHED  # AND already false
        QUOTES["NLSKIP"] = {"price": 9.0, "change_pct": -9.1, "prev_close": 9.9}
        assert (await _run_pass())["fired"] == 1
        assert ("regime", "NLSKIP") in FETCHED


async def test_weight_and_verdict_conditions_use_real_portfolio_data(fake_prices):  # noqa: F811
    async with _client() as c:
        h = await _token(c, "nl3@example.com")
        uid = await _user_id("nl3@example.com")
        pid = await _portfolio(c, h, [(1, {"AAA": 10, "BBB": 1})])
        async with AsyncSessionLocal() as db:
            db.add(Run(created_by=uid, ticker="AAA", analysis_date=date.today(), llm_provider="openai", llm_model="m",
                       depth="quick", status=RunStatus.completed, verdict=RunVerdict.sell))
            await db.commit()
        body = {"kind": "compound", "portfolio_id": pid, "params": {
            "op": "and", "scope": "holdings",
            "conditions": [{"type": "weight_above", "pct": 50}, {"type": "verdict", "verdict": "sell"}]}}
        assert (await c.post("/alerts/rules", json=body, headers=h)).status_code == 201
        assert (await _run_pass())["fired"] == 1
        ev = (await c.get("/alerts/events", headers=h)).json()[0]
        assert ev["data"]["matched"] == ["AAA"]
        assert "AI verdict SELL" in ev["title"] and "% of the portfolio" in ev["message"]


async def test_compound_rule_validation():
    async with _client() as c:
        h = await _token(c, "nl4@example.com")
        bad = [
            {"kind": "compound", "params": SEMIS_BEAR_BELOW_200},  # holdings scope needs a portfolio
            {"kind": "compound", "params": {"conditions": [{"type": "ma"}]}},  # ticker scope needs a ticker
            {"kind": "compound", "ticker": "NLX", "params": {"conditions": [{"type": "weight_above", "pct": 5}]}},
            {"kind": "compound", "ticker": "NLX", "params": {"conditions": []}},
            {"kind": "portfolio_drawdown", "portfolio_id": None, "params": {"pct": 5}, "rerun_analysis": True},
        ]
        for b in bad:
            r = await c.post("/alerts/rules", json=b, headers=h)
            assert r.status_code == 422, (b, r.text)
        pid = (await c.post("/portfolio", json={"name": "Solo"}, headers=h)).json()["id"]
        r = await c.post("/alerts/rules", json={"kind": "portfolio_drawdown", "portfolio_id": pid,
                                                 "params": {"pct": 5}, "rerun_analysis": True}, headers=h)
        assert r.status_code == 422 and "no analysis to re-run" in r.text
        ok = await c.post("/alerts/rules", json={"kind": "price_above", "ticker": "NLX", "params": {"price": 1}}, headers=h)
        rid = ok.json()["id"]
        upd = await c.patch(f"/alerts/rules/{rid}", json={"rerun_analysis": True}, headers=h)
        assert upd.json()["rerun_analysis"] is True


# ── re-run the analysis when it fires ─────────────────────────────────────────

@pytest.fixture
def fake_launch(monkeypatch):
    started: list[tuple[str, dict]] = []

    async def _fake_start(run_id, cfg):
        started.append((run_id, cfg))

    async def _fake_pick(db, user):
        return "openai", "gpt-4o-mini"

    import app.services.job_manager as jm
    import app.services.llm_selection as llm
    monkeypatch.setattr(jm, "start_run", _fake_start)
    monkeypatch.setattr(llm, "pick_llm_for_user", _fake_pick)
    monkeypatch.setattr(alert_engine, "MAX_RERUNS_PER_EVENT", 2)
    return started


async def test_rerun_starts_analyses_links_recent_ones_and_caps(fake_launch):
    async with _client() as c:
        h = await _token(c, "nl5@example.com")
        uid = await _user_id("nl5@example.com")
        pid = await _portfolio(c, h, [(1, {"NLRA": 1, "NLRB": 1, "NLRC": 1})])
        async with AsyncSessionLocal() as db:  # NLRA was analysed an hour ago
            recent = Run(created_by=uid, ticker="NLRA", analysis_date=date.today(), llm_provider="openai",
                         llm_model="m", depth="quick", status=RunStatus.completed, verdict=RunVerdict.hold,
                         created_at=datetime.now(timezone.utc) - timedelta(hours=1))
            db.add(recent)
            await db.commit()
            recent_id = str(recent.id)
        await c.post("/alerts/rules", json={"kind": "compound", "portfolio_id": pid, "rerun_analysis": True, "params": {
            "scope": "holdings", "conditions": [{"type": "regime", "regime": "Bear"}]}}, headers=h)
        REGIMES.update({"NLRA": "Bear", "NLRB": "Bear", "NLRC": "Bear"})
        assert (await _run_pass())["fired"] == 1

        assert [cfg["ticker"] for _, cfg in fake_launch] == ["NLRB"]  # NLRA linked, NLRC over the cap of 2
        ev = (await c.get("/alerts/events", headers=h)).json()[0]
        assert ev["delivery"]["analysis"] == "started 1; linked 1 recent; 1 over the limit of 2"
        by_ticker = {a["ticker"]: a for a in ev["analyses"]}
        assert by_ticker["NLRA"] == {"ticker": "NLRA", "run_id": recent_id, "source": "recent",
                                     "status": "completed", "verdict": "hold"}
        assert by_ticker["NLRB"]["source"] == "started" and by_ticker["NLRB"]["status"] == "pending"
        async with AsyncSessionLocal() as db:
            run = await db.get(Run, uuid.UUID(by_ticker["NLRB"]["run_id"]))
            assert run.label == "via alert" and run.created_by == uid and run.llm_model == "gpt-4o-mini"


async def test_rerun_without_an_llm_key_is_reported_not_fatal(monkeypatch):
    async def _no_llm(db, user):
        return None

    import app.services.llm_selection as llm
    monkeypatch.setattr(llm, "pick_llm_for_user", _no_llm)
    async with _client() as c:
        h = await _token(c, "nl6@example.com")
        await c.post("/alerts/rules", json={"kind": "price_below", "ticker": "NLNOKEY", "params": {"price": 50},
                                             "rerun_analysis": True}, headers=h)
        QUOTES["NLNOKEY"] = {"price": 40.0}
        assert (await _run_pass())["fired"] == 1
        ev = (await c.get("/alerts/events", headers=h)).json()[0]
        assert ev["delivery"]["analysis"].startswith("skipped: No LLM provider key")
        assert ev["delivery"]["inbox"] == "delivered" and ev["analyses"] == []


# ── POST /alerts/compile ──────────────────────────────────────────────────────

@pytest.fixture
def fake_llm(monkeypatch):
    state: dict = {"reply": None, "prompts": [], "pick": ("openai", "gpt-4o-mini")}

    async def _pick(db, user):
        return state["pick"]

    async def _key(provider, db):
        return "sk-test"

    async def _ask(provider, model, key, prompt):
        state["prompts"].append(prompt)
        if isinstance(state["reply"], Exception):
            raise state["reply"]
        return state["reply"] if isinstance(state["reply"], str) else json.dumps(state["reply"])

    import app.services.llm_selection as llm
    import app.services.portfolio_insight_runner as pir
    monkeypatch.setattr(llm, "pick_llm_for_user", _pick)
    monkeypatch.setattr(pir, "_get_api_key", _key)
    monkeypatch.setattr(alert_compiler, "ask_llm", _ask)
    return state


async def _rule_count(email: str) -> int:
    uid = await _user_id(email)
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(func.count()).select_from(AlertRule).where(AlertRule.user_id == uid))).scalar_one()


async def test_compile_holdings_sentence_fills_the_only_portfolio_and_never_saves(fake_llm):
    async with _client() as c:
        h = await _token(c, "nl7@example.com")
        pid = (await c.post("/portfolio", json={"name": "Core"}, headers=h)).json()["id"]
        fake_llm["reply"] = {"rule": {"kind": "compound", "ticker": None, "portfolio": None, "channels": ["inbox", "email"],
                                      "rerun_analysis": True, "params": {
                                          "op": "AND", "scope": "holdings", "sectors": ["Semiconductors"],
                                          "conditions": [{"type": "regime", "regime": "bear"},
                                                         {"type": "ma", "window": "200", "direction": "below"}]}},
                             "unsupported": []}
        r = await c.post("/alerts/compile", json={
            "text": "Tell me if any semiconductor holding goes Bear on Markov and drops below its 200-day, and re-run it"},
            headers=h)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["ok"] is True and out["problems"] == [] and out["needs_portfolio"] is False
        assert out["llm"] == "openai/gpt-4o-mini"
        rule = out["rule"]
        assert rule["portfolio_id"] == pid and rule["portfolio_name"] == "Core"
        assert rule["params"] == {"op": "and", "scope": "holdings", "sectors": ["Semiconductors"], "conditions": [
            {"type": "regime", "regime": "Bear"}, {"type": "ma", "window": 200, "direction": "below"}]}
        assert rule["channels"] == ["inbox", "email"] and rule["rerun_analysis"] is True
        assert '"Core"' in fake_llm["prompts"][0] and "semiconductor holding" in fake_llm["prompts"][0]
        assert await _rule_count("nl7@example.com") == 0  # compile never saves

        # The approved proposal saves as-is through the normal endpoint.
        saved = await c.post("/alerts/rules", json={k: rule[k] for k in (
            "kind", "ticker", "portfolio_id", "params", "channels", "cooldown_hours", "rerun_analysis")}, headers=h)
        assert saved.status_code == 201, saved.text
        assert saved.json()["params"] == rule["params"]


async def test_compile_asks_which_portfolio_when_there_are_several(fake_llm):
    async with _client() as c:
        h = await _token(c, "nl8@example.com")
        for name in ("Core", "Income"):
            await c.post("/portfolio", json={"name": name}, headers=h)
        fake_llm["reply"] = {"rule": {"kind": "position_weight", "params": {"pct": 25}, "channels": ["webhook"]},
                             "unsupported": []}
        out = (await c.post("/alerts/compile", json={"text": "warn me on Slack if a holding passes 25%"}, headers=h)).json()
        assert out["ok"] is True and out["needs_portfolio"] is True and out["rule"]["portfolio_id"] is None
        assert out["rule"]["channels"] == ["inbox", "webhook"]

        fake_llm["reply"]["rule"]["portfolio"] = "income"
        out = (await c.post("/alerts/compile", json={"text": "...in Income"}, headers=h)).json()
        assert out["needs_portfolio"] is False and out["rule"]["portfolio_name"] == "Income"

        fake_llm["reply"]["rule"]["portfolio"] = "Growth"
        out = (await c.post("/alerts/compile", json={"text": "...in Growth"}, headers=h)).json()
        assert out["ok"] is False and out["problems"] == ["You have no portfolio called 'Growth'."]


async def test_compile_reports_what_it_could_not_understand(fake_llm):
    async with _client() as c:
        h = await _token(c, "nl9@example.com")
        fake_llm["reply"] = {"rule": None, "unsupported": ["missing: how big a move"]}
        out = (await c.post("/alerts/compile", json={"text": "tell me if NVDA moves a lot"}, headers=h)).json()
        assert out == {"ok": False, "rule": None, "unsupported": ["missing: how big a move"], "problems": [],
                       "needs_portfolio": False, "llm": "openai/gpt-4o-mini"}

        # A partial translation keeps what it could express and lists the rest.
        fake_llm["reply"] = {"rule": {"kind": "price_below", "ticker": "nvda", "params": {"price": "120"},
                                      "channels": ["webhook"]},
                             "unsupported": ["when the CEO tweets"]}
        out = (await c.post("/alerts/compile", json={"text": "NVDA under 120 or when the CEO tweets, to Slack"}, headers=h)).json()
        assert out["ok"] is True and out["rule"]["ticker"] == "NVDA" and out["rule"]["params"] == {"price": 120.0}
        assert out["rule"]["channels"] == ["inbox"]  # no portfolio to take a webhook from
        assert out["unsupported"] == ["when the CEO tweets", "webhook delivery: pick a portfolio for its webhook before saving"]

        # Invalid output from the model is validated like a manual rule and explained.
        for reply, needle in [
            ({"rule": {"kind": "compound", "ticker": "NVDA", "params": {"conditions": [{"type": "astrology"}]}}}, "conditions"),
            ({"rule": {"kind": "price_above", "ticker": "NVDA", "params": {"price": -3}}}, "price"),
            ({"rule": {"kind": "earnings_soon", "ticker": "NVDA"}}, "Unknown alert kind"),
            ({"rule": {"kind": "portfolio_drawdown", "params": {"pct": 10}}}, "don't have one"),
            ("I'm sorry, I can't do that.", "did not reply with a rule"),
        ]:
            fake_llm["reply"] = reply
            out = (await c.post("/alerts/compile", json={"text": "something"}, headers=h)).json()
            assert out["ok"] is False and needle in out["problems"][0], (reply, out)
        assert await _rule_count("nl9@example.com") == 0


async def test_compile_errors(fake_llm):
    async with _client() as c:
        h = await _token(c, "nl10@example.com")
        assert (await c.post("/alerts/compile", json={"text": "x"}, headers=h)).status_code == 422  # too short
        assert (await c.post("/alerts/compile", json={"text": "y" * 501}, headers=h)).status_code == 422
        fake_llm["reply"] = RuntimeError("upstream 500")
        r = await c.post("/alerts/compile", json={"text": "NVDA above 200"}, headers=h)
        assert r.status_code == 502 and "upstream 500" in r.json()["detail"]
        fake_llm["pick"] = None
        r = await c.post("/alerts/compile", json={"text": "NVDA above 200"}, headers=h)
        assert r.status_code == 422 and "No LLM provider key" in r.json()["detail"]
    async with _client() as anon:
        assert (await anon.post("/alerts/compile", json={"text": "NVDA above 200"})).status_code in (401, 403)


async def test_events_only_show_the_callers_own_runs(fake_launch):
    """An event's analyses are looked up for the event's owner only."""
    async with _client() as c:
        h = await _token(c, "nl11@example.com")
        await c.post("/alerts/rules", json={"kind": "price_above", "ticker": "NLOWN", "params": {"price": 1},
                                             "rerun_analysis": True}, headers=h)
        QUOTES["NLOWN"] = {"price": 2.0}
        assert (await _run_pass())["fired"] == 1
        uid = await _user_id("nl11@example.com")
        async with AsyncSessionLocal() as db:
            ev = (await db.execute(select(AlertEvent).where(AlertEvent.user_id == uid))).scalar_one()
            run = await db.get(Run, uuid.UUID(ev.data["analyses"][0]["run_id"]))
            await db.delete(run)
            await db.commit()
        assert (await c.get("/alerts/events", headers=h)).json()[0]["analyses"][0]["status"] == "deleted"
