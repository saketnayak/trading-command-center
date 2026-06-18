"""Integration tests for the verdict-change extension on LastRun and the
GET /portfolio/{id}/trim-signals endpoint."""
import uuid
from datetime import datetime, date, timedelta, timezone

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from main import app
from app.database import AsyncSessionLocal
from app.models.user import User
from app.models.portfolio import Portfolio, PortfolioSnapshot, PortfolioHolding
from app.models.run import Run, RunStatus, RunVerdict
from app.services.auth import create_invite_token


async def _register_and_token(client: AsyncClient, email: str, invite_token: str | None = None) -> tuple[str, str]:
    payload = {"email": email, "password": "pass1234", "name": "Test"}
    if invite_token:
        payload["invite_token"] = invite_token
    r = await client.post(
        "/auth/register",
        json=payload,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return body["access_token"], body.get("user", {}).get("id") or await _user_id(email)


async def _user_id(email: str) -> str:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        u = result.scalar_one()
        return str(u.id)


async def _create_portfolio_with_holding(
    client: AsyncClient, token: str, ticker: str = "AAPL", shares: float = 10.0, avg_cost: float = 100.0
) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/portfolio", json={"name": "P"}, headers=headers)
    assert r.status_code == 200, r.text
    portfolio_id = r.json()["id"]

    # Manually create a snapshot with one holding (avoid CSV fixture for precise control)
    async with AsyncSessionLocal() as db:
        snap = PortfolioSnapshot(
            portfolio_id=portfolio_id,
            uploaded_at=datetime.now(timezone.utc),
            row_count=1,
        )
        db.add(snap)
        await db.flush()
        h = PortfolioHolding(
            snapshot_id=snap.id,
            ticker=ticker,
            shares=shares,
            avg_cost=avg_cost,
            currency="USD",
        )
        db.add(h)
        await db.commit()
    return portfolio_id


async def _insert_run(user_id: str, ticker: str, verdict: RunVerdict, days_ago: int) -> str:
    async with AsyncSessionLocal() as db:
        run = Run(
            created_by=user_id,
            ticker=ticker,
            analysis_date=date.today() - timedelta(days=days_ago),
            llm_provider="openai",
            llm_model="gpt-4o-mini",
            depth="quick",
            status=RunStatus.completed,
            verdict=verdict,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return str(run.id)


@pytest.mark.asyncio
async def test_last_run_has_no_previous_when_only_one_run():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token, user_id = await _register_and_token(c, "one_run@test.com")
        portfolio_id = await _create_portfolio_with_holding(c, token, ticker="AAPL")
        await _insert_run(user_id, "AAPL", RunVerdict.buy, days_ago=1)

        r = await c.get(
            f"/portfolio/{portfolio_id}/current",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    holdings = r.json()["holdings"]
    last_run = holdings[0]["last_run"]
    assert last_run["verdict"] == "buy"
    assert last_run.get("previous_verdict") is None
    assert last_run.get("previous_run_id") is None


@pytest.mark.asyncio
async def test_last_run_populates_previous_when_verdict_changed():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token, user_id = await _register_and_token(c, "changed@test.com")
        portfolio_id = await _create_portfolio_with_holding(c, token, ticker="MSFT")
        await _insert_run(user_id, "MSFT", RunVerdict.buy, days_ago=5)
        await _insert_run(user_id, "MSFT", RunVerdict.hold, days_ago=1)

        r = await c.get(
            f"/portfolio/{portfolio_id}/current",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    last_run = r.json()["holdings"][0]["last_run"]
    assert last_run["verdict"] == "hold"
    assert last_run["previous_verdict"] == "buy"
    assert last_run["previous_run_id"] is not None


@pytest.mark.asyncio
async def test_last_run_previous_none_when_verdicts_match():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token, user_id = await _register_and_token(c, "samematch@test.com")
        portfolio_id = await _create_portfolio_with_holding(c, token, ticker="NVDA")
        await _insert_run(user_id, "NVDA", RunVerdict.buy, days_ago=5)
        await _insert_run(user_id, "NVDA", RunVerdict.buy, days_ago=1)

        r = await c.get(
            f"/portfolio/{portfolio_id}/current",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    last_run = r.json()["holdings"][0]["last_run"]
    assert last_run["verdict"] == "buy"
    assert last_run.get("previous_verdict") is None


@pytest.mark.asyncio
async def test_trim_signals_empty_when_no_snapshot():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token, user_id = await _register_and_token(c, "nosnap@test.com")
        r0 = await c.post("/portfolio", json={"name": "Empty"}, headers={"Authorization": f"Bearer {token}"})
        portfolio_id = r0.json()["id"]

        r = await c.get(
            f"/portfolio/{portfolio_id}/trim-signals",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["entries"] == []


@pytest.mark.asyncio
async def test_trim_signals_level_none_for_holding_without_run():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token, user_id = await _register_and_token(c, "norun@test.com")
        portfolio_id = await _create_portfolio_with_holding(c, token, ticker="GOOG")

        r = await c.get(
            f"/portfolio/{portfolio_id}/trim-signals",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    entries = r.json()["entries"]
    assert len(entries) == 1
    assert entries[0]["ticker"] == "GOOG"
    assert entries[0]["level"] == "none"
    assert "No analysis yet" in entries[0]["reasons"]


@pytest.mark.asyncio
async def test_trim_signals_returns_strong_trim_when_verdict_sell():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token, user_id = await _register_and_token(c, "sellverdict@test.com")
        portfolio_id = await _create_portfolio_with_holding(c, token, ticker="TSLA")
        await _insert_run(user_id, "TSLA", RunVerdict.sell, days_ago=1)

        r = await c.get(
            f"/portfolio/{portfolio_id}/trim-signals",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    entries = r.json()["entries"]
    assert len(entries) == 1
    assert entries[0]["ticker"] == "TSLA"
    assert entries[0]["level"] == "strong_trim"
    assert any("AI verdict: SELL" in reason for reason in entries[0]["reasons"])


@pytest.mark.asyncio
async def test_trim_signals_unauthorized_for_other_user_portfolio():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        owner_token, _ = await _register_and_token(c, "owner@test.com")
        intruder_token, _ = await _register_and_token(
            c,
            "intruder@test.com",
            invite_token=create_invite_token("intruder@test.com"),
        )
        portfolio_id = await _create_portfolio_with_holding(c, owner_token, ticker="AMD")

        r = await c.get(
            f"/portfolio/{portfolio_id}/trim-signals",
            headers={"Authorization": f"Bearer {intruder_token}"},
        )
    assert r.status_code == 404
