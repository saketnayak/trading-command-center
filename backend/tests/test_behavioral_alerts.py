import pytest
from datetime import date, timedelta
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from main import app
from app.database import AsyncSessionLocal
from app.models.run import Run, RunStatus, RunVerdict
from app.models.user import User

FIXTURES_DIR = Path(__file__).parent / "fixtures"


async def _register_and_token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234", "name": "Test"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _create_portfolio_with_holdings(client: AsyncClient, token: str) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/portfolio", json={"name": "Test"}, headers=headers)
    assert r.status_code == 200
    portfolio_id = r.json()["id"]
    with open(FIXTURES_DIR / "generic_positions.csv", "rb") as f:
        r2 = await client.post(
            f"/portfolio/{portfolio_id}/upload",
            files={"file": ("positions.csv", f, "text/csv")},
            headers=headers,
        )
    assert r2.status_code == 200
    return portfolio_id


async def _get_user_id(email: str) -> str:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one()
        return str(user.id)


async def _insert_run(user_id: str, ticker: str, verdict: RunVerdict, days_ago: int) -> None:
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


@pytest.mark.asyncio
async def test_behavioral_alerts_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/portfolio/00000000-0000-0000-0000-000000000001/behavioral-alerts")
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_behavioral_alerts_404_missing_portfolio():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "ba_404@example.com")
        r = await c.get(
            "/portfolio/00000000-0000-0000-0000-000000000099/behavioral-alerts",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_behavioral_alerts_empty_portfolio_returns_zero():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "ba_empty@example.com")
        headers = {"Authorization": f"Bearer {token}"}
        r = await c.post("/portfolio", json={"name": "Empty"}, headers=headers)
        portfolio_id = r.json()["id"]
        r2 = await c.get(f"/portfolio/{portfolio_id}/behavioral-alerts", headers=headers)
        assert r2.status_code == 200
        data = r2.json()
        assert data["alert_count"] == 0
        assert data["alerts"] == []


@pytest.mark.asyncio
async def test_behavioral_alerts_ignored_sell_signal():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        email = "ba_sell@example.com"
        token = await _register_and_token(c, email)
        portfolio_id = await _create_portfolio_with_holdings(c, token)
        user_id = await _get_user_id(email)

        # TSLA is in the fixture; insert a sell verdict 31 days ago → critical
        await _insert_run(user_id, "TSLA", RunVerdict.sell, days_ago=31)

        r = await c.get(
            f"/portfolio/{portfolio_id}/behavioral-alerts",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        data = r.json()
        sell_alerts = [a for a in data["alerts"] if a["type"] == "ignored_sell_signal"]
        assert len(sell_alerts) == 1
        alert = sell_alerts[0]
        assert alert["severity"] == "critical"
        assert "TSLA" in alert["affected_tickers"]
        assert alert["days"] == 31
        assert data["critical_count"] >= 1


@pytest.mark.asyncio
async def test_behavioral_alerts_concentration_drift():
    """NVDA at 20 shares × $410 avg = $8,200; total portfolio ≈ $8,200+$8,120+$3,300 = $19,620 → NVDA = 41.8% > 25%."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        email = "ba_conc@example.com"
        token = await _register_and_token(c, email)
        portfolio_id = await _create_portfolio_with_holdings(c, token)

        r = await c.get(
            f"/portfolio/{portfolio_id}/behavioral-alerts",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        data = r.json()
        conc_alerts = [a for a in data["alerts"] if a["type"] == "concentration_drift"]
        # NVDA at 20×410=$8200 / (50×162.4 + 20×410 + 15×220) = $8200/$19820 ≈ 41.4% → fires
        assert len(conc_alerts) >= 1
        nvda_alert = next((a for a in conc_alerts if "NVDA" in a["affected_tickers"]), None)
        assert nvda_alert is not None
        assert nvda_alert["current_weight_pct"] > 25.0
