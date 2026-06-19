import json
import time
import pytest
from pathlib import Path
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from main import app
from app.database import AsyncSessionLocal
from app.models.api_key import ApiKey
from app.models.user import User
from app.services.encryption import encrypt_key
from app.services.llm_selection import pick_llm_for_user

FIXTURES_DIR = Path(__file__).parent / "fixtures"

MOCK_RECOMMENDATIONS = json.dumps([
    {"ticker": "XYZ", "tag": "Trending", "sector": "", "reason": "Strong momentum today."},
])


async def _register_and_token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234", "name": "Test"})
    return r.json()["access_token"]


async def _create_portfolio_with_holding(client: AsyncClient, token: str) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/portfolio", json={"name": "Test Portfolio"}, headers=headers)
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


@pytest.mark.asyncio
async def test_pick_llm_for_user_prefers_user_default():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_token(client, "discover-default@test.com")
        headers = {"Authorization": f"Bearer {token}"}
        await client.patch(
            "/auth/me",
            headers=headers,
            json={"default_llm_provider": "anthropic", "default_llm_model": "claude-sonnet-4-6"},
        )

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == "discover-default@test.com"))).scalar_one()
        db.add(ApiKey(provider="openai", encrypted_key=encrypt_key("sk-openai"), is_valid=True))
        db.add(ApiKey(provider="anthropic", encrypted_key=encrypt_key("sk-anthropic"), is_valid=True))
        await db.commit()

        picked = await pick_llm_for_user(db, user)
        assert picked == ("anthropic", "claude-sonnet-4-6")


@pytest.mark.asyncio
async def test_discover_rejects_unknown_provider():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "discover-badprov@test.com")
        portfolio_id = await _create_portfolio_with_holding(c, token)
        r = await c.post(
            f"/portfolio/{portfolio_id}/discover",
            json={"llm_provider": "cohere", "llm_model": "command-r"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_discover_uses_request_llm_provider():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "discover-prov@test.com")
        portfolio_id = await _create_portfolio_with_holding(c, token)

        captured: list[tuple[str, str]] = []

        async def _capture(provider, model, api_key, prompt):
            captured.append((provider, model))
            return MOCK_RECOMMENDATIONS

        import app.routers.market as market_module

        with (
            patch("app.services.portfolio_insight_runner._get_api_key", new=AsyncMock(return_value="sk-test")),
            patch("app.services.portfolio_insight_runner._call_llm", new=AsyncMock(side_effect=_capture)),
            patch.object(market_module, "_trending_cache", (["XYZ"], time.time() + 3600)),
        ):
            r = await c.post(
                f"/portfolio/{portfolio_id}/discover",
                json={"llm_provider": "groq", "llm_model": "llama-3.3-70b-versatile"},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert r.status_code == 200
        assert captured
        assert captured[0] == ("groq", "llama-3.3-70b-versatile")
