"""JEV Lab sessions: router, persistence sink, recovery and retention (needs the DB)."""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import app.routers.jev as jev_router
import app.services.jev_session_manager as manager
from app.database import AsyncSessionLocal
from app.models.api_key import ApiKey
from app.models.jev import JevSession, JevSessionStatus, JevTick
from app.models.settings import AppSettings
from app.models.user import User, UserRole
from app.services.encryption import encrypt_key
from main import app

ALPACA = json.dumps({"key_id": "PKTEST", "secret": "s"})


@pytest.fixture
def started(monkeypatch):
    calls: list[str] = []

    async def fake_start(session_id: str) -> None:
        calls.append(session_id)

    monkeypatch.setattr(jev_router, "start_session", fake_start)
    return calls


async def _setup(client, *, enabled=True, keys=(("alpaca_paper", ALPACA),), role=UserRole.admin) -> dict:
    r = await client.post("/auth/register", json={"email": "jev@example.com", "password": "pass1234", "name": "J"})
    token = r.json()["access_token"]
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == "jev@example.com"))).scalar_one()
        user.role = role
        settings = await db.get(AppSettings, 1)
        if settings is None:
            settings = AppSettings(id=1)
            db.add(settings)
        settings.enable_jev_loop = enabled
        for provider, key in keys:
            db.add(ApiKey(provider=provider, encrypted_key=encrypt_key(key), is_valid=True, created_by=user.id))
        await db.commit()
    return {"Authorization": f"Bearer {token}"}


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _insert_session(status=JevSessionStatus.running, mode="shadow", symbol="BTC/USD", **kw) -> uuid.UUID:
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User))).scalars().first()
        s = JevSession(created_by=user.id, symbol=symbol, mode=mode, status=status, order_prefix="jevlab-abcd1234-",
                       max_duration_s=3600, started_at=datetime.now(timezone.utc), **kw)
        db.add(s)
        await db.commit()
        return s.id


# -- feature flag ------------------------------------------------------------


async def test_everything_is_404_while_the_flag_is_off():
    async with _client() as c:
        h = await _setup(c, enabled=False)
        assert (await c.get("/jev/meta", headers=h)).status_code == 404
        assert (await c.post("/jev/sessions", json={"symbol": "BTC/USD"}, headers=h)).status_code == 404


async def test_meta_describes_the_split_and_the_defaults():
    async with _client() as c:
        h = await _setup(c)
        body = (await c.get("/jev/meta", headers=h)).json()
    assert body["split"]["deterministic"] and body["split"]["probabilistic"]
    assert body["limits"]["max_position_usd"] == 50.0
    assert "max_position_usd" in body["lowerable_limits"]
    assert "jev_interval_s" in body["lowerable_limits"] and body["limits"]["jev_interval_s"] == 6.0
    assert body["thresholds"]["toxic_flow_pull_threshold"] == 0.6


async def test_symbol_validation():
    async with _client() as c:
        h = await _setup(c)
        ok = await c.get("/jev/symbols/validate", params={"symbol": "btc-usd"}, headers=h)
        bad = await c.get("/jev/symbols/validate", params={"symbol": "???"}, headers=h)
    assert ok.json()["symbol"] == "BTC/USD" and ok.json()["is_24_7"] is True
    assert bad.status_code == 422


# -- creating sessions -------------------------------------------------------


async def test_create_a_shadow_session(started):
    async with _client() as c:
        h = await _setup(c)
        r = await c.post("/jev/sessions", json={"symbol": "BTC/USD", "max_ticks": 30}, headers=h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["mode"] == "shadow" and body["status"] == "running" and body["order_prefix"].startswith("jevlab-")
    assert started == [body["id"]]


async def test_market_data_needs_an_alpaca_key(started):
    async with _client() as c:
        h = await _setup(c, keys=())
        r = await c.post("/jev/sessions", json={"symbol": "BTC/USD"}, headers=h)
    assert r.status_code == 400 and "Alpaca" in r.json()["detail"]
    assert started == []


async def test_paper_mode_is_admin_only(started):
    async with _client() as c:
        h = await _setup(c, role=UserRole.member, keys=(("alpaca_paper", ALPACA), ("ai_gateway", "vck")))
        r = await c.post("/jev/sessions", json={"symbol": "BTC/USD", "mode": "paper"}, headers=h)
    assert r.status_code == 403


async def test_paper_mode_needs_a_real_jev_key(started):
    async with _client() as c:
        h = await _setup(c)
        r = await c.post("/jev/sessions", json={"symbol": "BTC/USD", "mode": "paper"}, headers=h)
    assert r.status_code == 400 and "Jev" in r.json()["detail"]


async def test_paper_mode_with_keys_is_accepted(started):
    async with _client() as c:
        h = await _setup(c, keys=(("alpaca_paper", ALPACA), ("ai_gateway", "vck")))
        r = await c.post("/jev/sessions", json={"symbol": "BTC/USD", "mode": "paper"}, headers=h)
    assert r.status_code == 201 and r.json()["mode"] == "paper"


@pytest.mark.parametrize(
    "body",
    [
        {"symbol": "???"},
        {"symbol": "BTC/USD", "limits": {"max_position_usd": 10_000}},
        {"symbol": "BTC/USD", "thresholds": {"toxic_flow_pull_threshold": 3}},
        {"symbol": "BTC/USD", "max_duration_minutes": 100_000},
    ],
)
async def test_bad_requests_are_rejected(started, body):
    async with _client() as c:
        h = await _setup(c)
        assert (await c.post("/jev/sessions", json=body, headers=h)).status_code == 422
    assert started == []


async def test_at_most_two_sessions_run_at_once(started):
    async with _client() as c:
        h = await _setup(c)
        await _insert_session(symbol="ETH/USD")
        await _insert_session(symbol="SOL/USD")
        r = await c.post("/jev/sessions", json={"symbol": "BTC/USD"}, headers=h)
    assert r.status_code == 409


async def test_one_paper_session_per_symbol(started):
    async with _client() as c:
        h = await _setup(c, keys=(("alpaca_paper", ALPACA), ("ai_gateway", "vck")))
        await _insert_session(mode="paper")
        r = await c.post("/jev/sessions", json={"symbol": "BTC/USD", "mode": "paper"}, headers=h)
    assert r.status_code == 409


# -- reading, stopping, calibration ---------------------------------------------


async def test_ticks_list_and_calibration():
    async with _client() as c:
        h = await _setup(c)
        sid = await _insert_session(status=JevSessionStatus.completed)
        async with AsyncSessionLocal() as db:
            for i, (d, mid) in enumerate([("up", 100.0), ("down", 101.0), (None, 102.0)], start=1):
                db.add(JevTick(session_id=sid, tick=i, ts=datetime.now(timezone.utc), mid=mid, action="QUOTE_WIDE",
                               rung="run", direction=d, direction_conf=0.8 if d else None, inventory=0.0, orders=[]))
            await db.commit()
        ticks = (await c.get(f"/jev/sessions/{sid}/ticks", params={"after": 1}, headers=h)).json()
        cal = (await c.get(f"/jev/sessions/{sid}/calibration", params={"horizon": 1}, headers=h)).json()
        listed = (await c.get("/jev/sessions", headers=h)).json()
    assert [t["tick"] for t in ticks] == [2, 3]
    assert cal["n"] == 2 and cal["brier"] is not None
    assert listed[0]["id"] == str(sid)


async def test_stopping_an_orphaned_running_session_marks_it_stopped():
    async with _client() as c:
        h = await _setup(c)
        sid = await _insert_session()
        r = await c.post(f"/jev/sessions/{sid}/stop", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "stopped"


async def test_flatten_is_only_for_finished_paper_sessions():
    async with _client() as c:
        h = await _setup(c)
        running = await _insert_session(mode="paper")
        shadow = await _insert_session(status=JevSessionStatus.stopped, symbol="ETH/USD")
        assert (await c.post(f"/jev/sessions/{running}/flatten", headers=h)).status_code == 409
        assert (await c.post(f"/jev/sessions/{shadow}/flatten", headers=h)).status_code == 400


# -- sink, recovery, retention ------------------------------------------------


async def test_the_db_sink_persists_ticks_and_status(monkeypatch):
    sent = []

    async def fake_broadcast(key, data):
        sent.append((key, data["type"]))

    monkeypatch.setattr(manager.ws_manager, "broadcast", fake_broadcast)
    async with _client() as c:
        await _setup(c)
    sid = await _insert_session()
    sink = manager.DbSink(sid)
    summary = {"tick_count": 1, "inventory": 0.5, "realised_pnl_usd": 1.5, "last_mid": 100.0, "fills": 1,
               "orders_submitted": 2, "orders_rejected": 0, "decision_route": "MOCK", "decision_model": "mock-jev-0.1",
               "cost_usd": 0.0, "start_equity_usd": 50.0}
    record = {"tick": 1, "ts": 1_790_000_000.0, "mid": 100.0, "spread_bps": 1.0, "action": "QUOTE_WIDE",
              "action_reason": "x", "rung": "run", "direction_leg": None, "direction": "up", "direction_conf": 0.7,
              "latency_ms": 80.0, "route": "MOCK", "model": "mock-jev-0.1", "inventory": 0.5,
              "jev_status": "answered", "jev_provider": "typesafe-ai", "answer_age_s": 0.0,
              "unrealised_pnl_usd": 0.0, "realised_pnl_usd": 1.5, "drawdown_pct": 0.0, "fill": "-",
              "orders": [], "answers": {"a": 1}, "snapshot": {"mid": 100.0}}
    await sink.on_tick(record, summary)
    await sink.on_status("completed", "tick limit reached", summary)
    async with AsyncSessionLocal() as db:
        s = await db.get(JevSession, sid)
        ticks = (await db.execute(select(JevTick).where(JevTick.session_id == sid))).scalars().all()
    assert s.status == JevSessionStatus.completed and s.stop_reason == "tick limit reached"
    assert s.tick_count == 1 and s.inventory == 0.5 and s.stopped_at is not None
    assert len(ticks) == 1 and ticks[0].answers == {"a": 1}
    assert (ticks[0].jev_status, ticks[0].jev_provider, ticks[0].answer_age_s) == ("answered", "typesafe-ai", 0.0)
    assert sent == [(f"jev:{sid}", "tick"), (f"jev:{sid}", "status")]


async def test_startup_recovery_marks_running_sessions_interrupted_and_cancels_paper_orders(monkeypatch):
    cancelled = []

    class FakeClient:
        def __init__(self, prefix):
            self.prefix = prefix

        async def cancel_own_orders(self):
            cancelled.append(self.prefix)
            return 1

        async def aclose(self):
            pass

    async def fake_factory(db, spec, order_prefix, id_namespace=""):
        return FakeClient(order_prefix)

    monkeypatch.setattr(manager, "alpaca_client_from_db", fake_factory)
    async with _client() as c:
        await _setup(c)
    paper = await _insert_session(mode="paper")
    shadow = await _insert_session(symbol="ETH/USD")
    await manager.recover_interrupted_sessions()
    async with AsyncSessionLocal() as db:
        assert (await db.get(JevSession, paper)).status == JevSessionStatus.interrupted
        assert (await db.get(JevSession, shadow)).status == JevSessionStatus.interrupted
    assert cancelled == ["jevlab-abcd1234-"]


async def test_old_ticks_are_pruned():
    async with _client() as c:
        await _setup(c)
    sid = await _insert_session(status=JevSessionStatus.completed)
    async with AsyncSessionLocal() as db:
        old = datetime.now(timezone.utc) - timedelta(days=20)
        db.add(JevTick(session_id=sid, tick=1, ts=old, action="X", rung="run", inventory=0.0, orders=[]))
        db.add(JevTick(session_id=sid, tick=2, ts=datetime.now(timezone.utc), action="X", rung="run", inventory=0.0, orders=[]))
        await db.commit()
    assert await manager.prune_old_ticks(days=14) == 1


async def test_a_real_shadow_session_runs_end_to_end(httpx_mock, monkeypatch):
    """execute_session wires DB -> clients -> loop -> DB; only Alpaca HTTP is stubbed."""
    import re

    monkeypatch.setattr(manager.ws_manager, "broadcast", _noop_broadcast)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    httpx_mock.add_response(url="https://paper-api.alpaca.markets/v2/account", json={"equity": "100000"})
    httpx_mock.add_response(url=re.compile(r".*/crypto/us/bars\?.*"), json={"bars": {"BTC/USD": []}})
    httpx_mock.add_response(
        url=re.compile(r".*/crypto/us/latest/orderbooks\?.*"),
        json={"orderbooks": {"BTC/USD": {"t": now, "b": [{"p": 99995.0, "s": 1}], "a": [{"p": 100005.0, "s": 1}]}}},
        is_reusable=True,
    )
    httpx_mock.add_response(url=re.compile(r".*/crypto/us/trades\?.*"), json={"trades": {"BTC/USD": []}}, is_reusable=True)

    async with _client() as c:
        await _setup(c)
    sid = await _insert_session(max_ticks=2, force_mock=True)
    await manager.execute_session(str(sid))

    async with AsyncSessionLocal() as db:
        s = await db.get(JevSession, sid)
        ticks = (await db.execute(select(JevTick).where(JevTick.session_id == sid))).scalars().all()
    assert s.status == JevSessionStatus.completed and s.tick_count == 2
    assert s.decision_route == "MOCK" and s.start_equity_usd == 100000.0
    assert len(ticks) == 2 and all(t.mid == 100000.0 for t in ticks)
    assert all(o["status"] == "shadow" for t in ticks for o in t.orders)
    assert not any(r.method == "POST" for r in httpx_mock.get_requests())  # no order ever sent


async def _noop_broadcast(key, data):
    return None


@pytest.mark.unit
async def test_recovery_never_blocks_app_startup(monkeypatch):
    class Broken:
        async def __aenter__(self):
            raise RuntimeError("relation jev_sessions does not exist")

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(manager, "AsyncSessionLocal", lambda: Broken())
    await manager.recover_interrupted_sessions()  # must not raise


async def test_tail_returns_the_latest_ticks_oldest_first():
    async with _client() as c:
        h = await _setup(c)
        sid = await _insert_session(status=JevSessionStatus.completed)
        async with AsyncSessionLocal() as db:
            for i in range(1, 6):
                db.add(JevTick(session_id=sid, tick=i, ts=datetime.now(timezone.utc), action="X", rung="run",
                               inventory=0.0, orders=[], answers={"n": i}))
            await db.commit()
        latest = (await c.get(f"/jev/sessions/{sid}/ticks", params={"tail": 2, "full": True}, headers=h)).json()
    assert [t["tick"] for t in latest] == [4, 5]
    assert latest[-1]["answers"] == {"n": 5}
