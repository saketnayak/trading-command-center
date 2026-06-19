import pytest
from httpx import AsyncClient, ASGITransport
from main import app


async def _token(client, email="llm-default@test.com"):
    await client.post("/auth/register", json={"email": email, "password": "password1", "name": "LLM Default"})
    r = await client.post("/auth/login", json={"email": email, "password": "password1"})
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_me_includes_default_llm_config():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client)
        r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        body = r.json()
        assert body["default_llm_provider"] == "openai"
        assert body["default_llm_model"] is None
        assert body["default_llm_depth"] == "standard"


@pytest.mark.asyncio
async def test_update_default_llm_config():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client, "llm-default2@test.com")
        headers = {"Authorization": f"Bearer {token}"}
        r = await client.patch(
            "/auth/me",
            headers=headers,
            json={
                "default_llm_provider": "anthropic",
                "default_llm_model": "claude-sonnet-4-6",
                "default_llm_depth": "deep",
            },
        )
        assert r.status_code == 200

        me = await client.get("/auth/me", headers=headers)
        assert me.json()["default_llm_provider"] == "anthropic"
        assert me.json()["default_llm_model"] == "claude-sonnet-4-6"
        assert me.json()["default_llm_depth"] == "deep"


@pytest.mark.asyncio
async def test_update_default_llm_rejects_unknown_provider():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client, "llm-default3@test.com")
        r = await client.patch(
            "/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"default_llm_provider": "cohere"},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_run_create_rejects_unknown_provider():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _token(client, "llm-default4@test.com")
        r = await client.post(
            "/runs",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "ticker": "AAPL",
                "analysis_date": "2026-06-19",
                "llm_provider": "cohere",
                "llm_model": "command-r",
                "depth": "standard",
            },
        )
        assert r.status_code == 422
