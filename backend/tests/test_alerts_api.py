"""Integration tests: alert rule API, the evaluation pass, inbox and delivery.

Quotes and regimes are scripted through a MarketData subclass; verdicts and
portfolio weights go through the real DB/performance paths."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.alert import AlertEvent, AlertRule
from app.models.portfolio_delivery_settings import PortfolioDeliverySettings
from app.models.run import Run, RunStatus, RunVerdict
from app.services import alert_engine
from tests.test_portfolio_performance import _client, _portfolio, _token, fake_prices  # noqa: F401

QUOTES: dict[str, dict] = {}
REGIMES: dict[str, str] = {}


class ScriptedData(alert_engine.MarketData):
    async def quote(self, ticker):
        return QUOTES.get(ticker)

    async def regime(self, ticker):
        return {"regime": REGIMES[ticker]} if ticker in REGIMES else None


@pytest.fixture(autouse=True)
def _reset():
    QUOTES.clear()
    REGIMES.clear()


async def _run_pass():
    return await alert_engine.evaluate_all_alerts(data_factory=ScriptedData)


async def _user_id(email: str) -> uuid.UUID:
    from app.models.user import User
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(User.id).where(User.email == email))).scalar_one()


async def test_rule_crud_validation_and_ownership():
    async with _client() as c, _client() as other:
        h = await _token(c, "al1@example.com")
        oh = await _token(other, "al2@example.com")
        r = await c.post("/alerts/rules", json={"kind": "price_above", "ticker": " aapl ", "params": {"price": 200}}, headers=h)
        assert r.status_code == 201, r.text
        rule = r.json()
        assert rule["ticker"] == "AAPL" and rule["channels"] == ["inbox"] and rule["cooldown_hours"] == 6

        bad = [
            {"kind": "price_above", "ticker": "AAPL", "params": {"price": 0}},
            {"kind": "price_above", "params": {"price": 1}},  # no ticker
            {"kind": "portfolio_drawdown", "params": {"pct": 10}},  # no portfolio
            {"kind": "nope", "ticker": "AAPL"},
            {"kind": "price_above", "ticker": "AAPL", "params": {"price": 1}, "channels": ["webhook"]},  # webhook needs a portfolio
            {"kind": "price_above", "ticker": "AAPL", "params": {"price": 1}, "channels": ["sms"]},
        ]
        for body in bad:
            assert (await c.post("/alerts/rules", json=body, headers=h)).status_code == 422, body

        other_pid = (await other.post("/portfolio", json={"name": "Theirs"}, headers=oh)).json()["id"]
        stolen = await c.post("/alerts/rules", json={"kind": "portfolio_drawdown", "portfolio_id": other_pid, "params": {"pct": 5}}, headers=h)
        assert stolen.status_code == 404

        assert [x["id"] for x in (await c.get("/alerts/rules", headers=h)).json()] == [rule["id"]]
        assert (await other.get("/alerts/rules", headers=oh)).json() == []
        assert (await other.patch(f"/alerts/rules/{rule['id']}", json={"enabled": False}, headers=oh)).status_code == 404

        upd = await c.patch(f"/alerts/rules/{rule['id']}", json={"params": {"price": 250}, "enabled": False}, headers=h)
        assert upd.json()["params"] == {"price": 250.0} and upd.json()["enabled"] is False
        assert (await c.delete(f"/alerts/rules/{rule['id']}", headers=h)).status_code == 204
        assert (await c.get("/alerts/rules", headers=h)).json() == []


async def test_price_alert_fires_once_then_rearms_and_respects_cooldown():
    async with _client() as c:
        h = await _token(c, "al3@example.com")
        rid = (await c.post("/alerts/rules", json={"kind": "price_above", "ticker": "AAPL", "params": {"price": 200},
                                                    "cooldown_hours": 0}, headers=h)).json()["id"]
        QUOTES["AAPL"] = {"price": 199.0, "change_pct": 0.1}
        assert (await _run_pass())["fired"] == 0
        QUOTES["AAPL"] = {"price": 201.5, "change_pct": 1.3}
        assert (await _run_pass())["fired"] == 1
        assert (await _run_pass())["fired"] == 0  # still above: quiet

        events = (await c.get("/alerts/events", headers=h)).json()
        assert len(events) == 1 and events[0]["title"] == "AAPL above 200.00"
        assert events[0]["delivery"] == {"inbox": "delivered"}
        assert (await c.get("/alerts/unread-count", headers=h)).json() == {"unread": 1}

        # Falls back below, then crosses again: fires again (cooldown 0).
        QUOTES["AAPL"] = {"price": 198.0}
        await _run_pass()
        QUOTES["AAPL"] = {"price": 202.0}
        assert (await _run_pass())["fired"] == 1

        # With a cooldown, the next crossing is swallowed.
        await c.patch(f"/alerts/rules/{rid}", json={"cooldown_hours": 24}, headers=h)
        QUOTES["AAPL"] = {"price": 198.0}
        await _run_pass()
        QUOTES["AAPL"] = {"price": 203.0}
        assert (await _run_pass())["fired"] == 0

        marked = await c.post("/alerts/events/read", json={"all": True}, headers=h)
        assert marked.json() == {"marked": 2}
        assert (await c.get("/alerts/unread-count", headers=h)).json() == {"unread": 0}
        assert (await c.get("/alerts/events?unread_only=true", headers=h)).json() == []


async def test_disabled_rules_and_missing_data_do_not_fire():
    async with _client() as c:
        h = await _token(c, "al4@example.com")
        await c.post("/alerts/rules", json={"kind": "price_below", "ticker": "AAA", "params": {"price": 50}, "enabled": False}, headers=h)
        rid = (await c.post("/alerts/rules", json={"kind": "price_below", "ticker": "NODATA", "params": {"price": 50}}, headers=h)).json()["id"]
        QUOTES["AAA"] = {"price": 10.0}
        assert (await _run_pass())["fired"] == 0
        rule = next(r for r in (await c.get("/alerts/rules", headers=h)).json() if r["id"] == rid)
        assert rule["last_checked_at"] and rule["last_error"] == "No data available right now"


async def test_regime_change_baseline_then_fire():
    async with _client() as c:
        h = await _token(c, "al5@example.com")
        await c.post("/alerts/rules", json={"kind": "regime_change", "ticker": "BTC-USD", "params": {"to": "Bear"}}, headers=h)
        REGIMES["BTC-USD"] = "Bull"
        assert (await _run_pass())["fired"] == 0  # baseline
        REGIMES["BTC-USD"] = "Bear"
        assert (await _run_pass())["fired"] == 1
        assert (await c.get("/alerts/events", headers=h)).json()[0]["title"] == "BTC-USD regime: Bull → Bear"


async def test_verdict_change_reads_completed_runs():
    async with _client() as c:
        h = await _token(c, "al6@example.com")
        uid = await _user_id("al6@example.com")
        await c.post("/alerts/rules", json={"kind": "verdict_change", "ticker": "MSFT"}, headers=h)

        async def add_run(verdict: RunVerdict, minutes_ago: int) -> str:
            async with AsyncSessionLocal() as db:
                run = Run(created_by=uid, ticker="MSFT", analysis_date=date.today(), llm_provider="openai",
                          llm_model="m", depth="quick", status=RunStatus.completed, verdict=verdict,
                          created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago))
                db.add(run)
                await db.commit()
                return str(run.id)

        await add_run(RunVerdict.hold, 10)
        assert (await _run_pass())["fired"] == 0  # baseline HOLD
        run_id = await add_run(RunVerdict.sell, 1)
        assert (await _run_pass())["fired"] == 1
        ev = (await c.get("/alerts/events", headers=h)).json()[0]
        assert ev["title"] == "MSFT AI verdict: HOLD → SELL" and ev["data"]["run_id"] == run_id


async def test_position_weight_uses_portfolio_values_and_webhook_delivery(fake_prices, monkeypatch):  # noqa: F811
    sent: list[dict] = []

    class _Resp:
        is_success = True
        status_code = 200

    async def _post(url, json=None, **kw):
        sent.append({"url": url, "json": json})
        return _Resp()

    monkeypatch.setattr(alert_engine._http, "post", _post)
    async with _client() as c:
        h = await _token(c, "al7@example.com")
        pid = await _portfolio(c, h, [(1, {"AAA": 10, "BBB": 1})])
        async with AsyncSessionLocal() as db:
            db.add(PortfolioDeliverySettings(portfolio_id=uuid.UUID(pid), webhook_enabled=True,
                                             webhook_url="https://hooks.example.com/x", webhook_format="slack"))
            await db.commit()
        r = await c.post("/alerts/rules", json={"kind": "position_weight", "portfolio_id": pid, "params": {"pct": 50},
                                                 "channels": ["webhook", "email"]}, headers=h)
        assert r.json()["channels"] == ["inbox", "email", "webhook"]
        assert (await _run_pass())["fired"] == 1

        ev = (await c.get("/alerts/events", headers=h)).json()[0]
        assert ev["title"] == "AAA now over 50% of Perf"
        assert ev["delivery"]["webhook"] == "sent"
        assert ev["delivery"]["email"] == "skipped: SMTP not configured"
        assert sent[0]["url"] == "https://hooks.example.com/x"
        assert sent[0]["json"]["text"].startswith("*AAA now over 50% of Perf*")


async def test_check_now_is_a_dry_run(monkeypatch):
    monkeypatch.setattr(alert_engine, "MarketData", ScriptedData)  # check_rule's default data source
    async with _client() as c:
        h = await _token(c, "al8@example.com")
        rid = (await c.post("/alerts/rules", json={"kind": "price_above", "ticker": "ZZZ", "params": {"price": 5}}, headers=h)).json()["id"]
        QUOTES["ZZZ"] = {"price": 7.25}
        body = (await c.post(f"/alerts/rules/{rid}/check", headers=h)).json()
    assert body["condition"] is True and body["would_fire"] is True
    assert body["observed"] == "Last price 7.25 (is above 5.00)"
    async with AsyncSessionLocal() as db:
        rule = await db.get(AlertRule, uuid.UUID(rid))
        assert rule.state is None and rule.last_triggered_at is None
        assert (await db.execute(select(AlertEvent))).scalars().all() == []


async def test_overlapping_passes_are_skipped():
    async with alert_engine._pass_lock:  # a pass is "running"
        result = await _run_pass()
    assert result == {"checked": 0, "fired": 0, "skipped": True}
    assert "skipped" not in await _run_pass()
