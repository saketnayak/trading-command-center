import pytest
from httpx import AsyncClient, ASGITransport
from main import app


async def _get_token(client, email="runs@test.com"):
    await client.post("/auth/register", json={"email": email, "password": "pw", "name": "Test"})
    r = await client.post("/auth/login", json={"email": email, "password": "pw"})
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_list_runs_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/runs")
        assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_runs_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _get_token(client, "runs2@test.com")
        r = await client.get("/runs", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)
