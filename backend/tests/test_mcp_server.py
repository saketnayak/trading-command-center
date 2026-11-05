"""MCP server end to end: token CRUD over the REST API, then the official MCP
client speaking Streamable HTTP to /mcp (in-process ASGI transport)."""
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import select, update

from main import app
from app.database import AsyncSessionLocal
from app.mcp_server import McpDispatch, build_server
from app.models.mcp_token import McpToken
from app.models.run import Run
from tests.test_portfolio_performance import _client, _portfolio, _token, fake_prices  # noqa: F401


@asynccontextmanager
async def mcp_session(token: str | None):
    """A real MCP ClientSession against a fresh server instance mounted like production."""
    server = build_server()
    asgi = McpDispatch(app, server.streamable_http_app())

    headers = {"Authorization": f"Bearer {token}"} if token else {}
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=asgi), base_url="http://test", headers=headers)
    async with server.session_manager.run(), http:
        async with streamable_http_client("http://test/mcp", http_client=http) as (r, w, _):
            async with ClientSession(r, w) as session:
                await session.initialize()
                yield session


async def _raw_post(token: str | None) -> int:
    """Status of a bare initialize POST (auth failures happen before MCP)."""
    server = build_server()
    asgi = McpDispatch(app, server.streamable_http_app())
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
    headers = {"Accept": "application/json, text/event-stream"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with server.session_manager.run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=asgi), base_url="http://test") as c:
            return (await c.post("/mcp", json=body, headers=headers)).status_code


def _json(result) -> object:
    """A tool's structured result. FastMCP wraps non-object returns (lists, Optional) as {"result": ...}."""
    assert not result.isError, result.content[0].text
    sc = result.structuredContent
    if sc is None:
        return json.loads(result.content[0].text)
    return sc["result"] if set(sc) == {"result"} else sc


async def _make_token(c, h, scopes=("read",), days=90) -> dict:
    r = await c.post("/mcp-tokens", headers=h, json={"name": "Claude Desktop", "scopes": list(scopes), "expires_in_days": days})
    assert r.status_code == 201, r.text
    return r.json()


async def test_token_lifecycle_and_auth_failures():
    async with _client() as c, _client() as other:
        h = await _token(c, "mcp1@example.com")
        oh = await _token(other, "mcp2@example.com")
        made = await _make_token(c, h)
        assert made["token"].startswith("af_") and made["scopes"] == ["read"] and made["active"]
        listed = (await c.get("/mcp-tokens", headers=h)).json()
        assert listed["available"] is True
        assert [t["id"] for t in listed["tokens"]] == [made["id"]]
        assert "token" not in listed["tokens"][0]  # shown only once
        async with AsyncSessionLocal() as db:
            row = await db.get(McpToken, uuid.UUID(made["id"]))
            assert row.token_hash != made["token"] and len(row.token_hash) == 64

        assert await _raw_post(None) == 401
        assert await _raw_post("af_not-a-real-token") == 401
        assert await _raw_post(made["token"]) == 200

        assert (await other.delete(f"/mcp-tokens/{made['id']}", headers=oh)).status_code == 404
        assert (await c.delete(f"/mcp-tokens/{made['id']}", headers=h)).status_code == 204
        assert await _raw_post(made["token"]) == 401  # revoked
        assert (await c.get("/mcp-tokens", headers=h)).json()["tokens"] == []

        expired = await _make_token(c, h)
        async with AsyncSessionLocal() as db:
            await db.execute(update(McpToken).where(McpToken.id == uuid.UUID(expired["id"]))
                             .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
            await db.commit()
        assert await _raw_post(expired["token"]) == 401


async def test_read_tools_see_only_the_callers_data(fake_prices):  # noqa: F811
    async with _client() as c, _client() as other:
        h = await _token(c, "mcp3@example.com")
        oh = await _token(other, "mcp4@example.com")
        pid = await _portfolio(c, h, [(1, {"AAA": 10, "BBB": 5})])
        theirs = await _portfolio(other, oh, [(1, {"AAA": 1})])
        tok = (await _make_token(c, h))["token"]

    async with mcp_session(tok) as s:
        names = {t.name for t in (await s.list_tools()).tools}
        assert {"list_portfolios", "get_holdings", "get_performance", "get_risk", "get_rebalance_plan", "get_regime",
                "list_runs", "get_run_report", "get_latest_insight", "list_alerts", "get_income", "get_tax_report", "get_net_worth", "get_filings", "start_analysis",
                "generate_portfolio_insight"} <= names
        assert not any("order" in n or "trade" in n or "jev" in n for n in names)

        ports = _json(await s.call_tool("list_portfolios", {}))
        assert [p["id"] for p in ports] == [pid]

        holdings = _json(await s.call_tool("get_holdings", {"portfolio_id": pid}))
        assert {h["ticker"] for h in holdings["holdings"]} == {"AAA", "BBB"}
        assert holdings["total_value"] > 0 and abs(sum(h["weight"] for h in holdings["holdings"]) - 1) < 1e-3

        perf = _json(await s.call_tool("get_performance", {"portfolio_id": pid, "range": "3m"}))
        assert perf["stats"]["total_return"] is not None and perf["mode"] == "current"
        assert len(perf["series"]) <= 5  # month-ends only

        denied = await s.call_tool("get_holdings", {"portfolio_id": theirs})
        assert denied.isError and "Portfolio not found" in denied.content[0].text
        bad = await s.call_tool("get_performance", {"portfolio_id": pid, "range": "10y"})
        assert bad.isError


async def test_research_tools_need_the_research_scope(monkeypatch):
    started: list[str] = []

    async def _fake_start(run_id, cfg):
        started.append(run_id)

    async def _fake_pick(db, user):
        return "openai", "gpt-4o-mini"

    import app.services.job_manager as jm
    import app.services.llm_selection as llm
    monkeypatch.setattr(jm, "start_run", _fake_start)
    monkeypatch.setattr(llm, "pick_llm_for_user", _fake_pick)

    async with _client() as c:
        h = await _token(c, "mcp5@example.com")
        read_tok = (await _make_token(c, h))["token"]
        research_tok = (await _make_token(c, h, scopes=("read", "research")))["token"]

    async with mcp_session(read_tok) as s:
        res = await s.call_tool("start_analysis", {"ticker": "AAPL"})
        assert res.isError and "read-only" in res.content[0].text
    assert started == []

    async with mcp_session(research_tok) as s:
        out = _json(await s.call_tool("start_analysis", {"ticker": "aapl", "depth": "quick"}))
    assert out["ticker"] == "AAPL" and started == [out["run_id"]]
    async with AsyncSessionLocal() as db:
        run = (await db.execute(select(Run).where(Run.id == uuid.UUID(out["run_id"])))).scalar_one()
        assert run.label == "via MCP" and run.llm_provider == "openai"
        token_row = (await db.execute(select(McpToken).where(McpToken.scopes.contains(["research"])))).scalar_one()
        assert token_row.last_used_at is not None


@pytest.mark.unit
def test_dispatch_only_takes_the_mcp_path():
    seen = []

    async def api(scope, receive, send):
        seen.append(("api", scope["path"]))

    async def mcp(scope, receive, send):
        seen.append(("mcp", scope["path"]))

    import asyncio
    d = McpDispatch(api, mcp)
    for path in ("/mcp", "/mcp/", "/mcp-tokens", "/portfolio", "/mcpx"):
        asyncio.run(d({"type": "http", "path": path}, None, None))
    assert seen == [("mcp", "/mcp"), ("mcp", "/mcp"), ("api", "/mcp-tokens"), ("api", "/portfolio"), ("api", "/mcpx")]


async def test_get_xray_reads_only_the_callers_portfolio(fake_prices):  # noqa: F811
    async with _client() as c, _client() as other:
        h = await _token(c, "mcp-xray@example.com")
        oh = await _token(other, "mcp-xray2@example.com")
        pid = await _portfolio(c, h, [(1, {"AAA": 10, "BBB": 5})])
        theirs = await _portfolio(other, oh, [(1, {"AAA": 1})])
        tok = (await _make_token(c, h))["token"]

    async with mcp_session(tok) as s:
        out = _json(await s.call_tool("get_xray", {"portfolio_id": pid}))
        assert out["funds"] == [] and {r["ticker"] for r in out["exposures"]} == {"AAA", "BBB"}
        denied = await s.call_tool("get_xray", {"portfolio_id": theirs})
        assert denied.isError
