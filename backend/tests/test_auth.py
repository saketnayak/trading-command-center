import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.mark.asyncio
async def test_register_and_login():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/auth/register", json={
            "email": "test@example.com", "password": "password123", "name": "Test User"
        })
        assert r.status_code == 200
        assert "access_token" in r.json()

        r2 = await client.post("/auth/login", json={
            "email": "test@example.com", "password": "password123"
        })
        assert r2.status_code == 200
        assert "access_token" in r2.json()


@pytest.mark.asyncio
async def test_wrong_password_returns_401():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/auth/register", json={
            "email": "test2@example.com", "password": "correct", "name": "Test"
        })
        r = await client.post("/auth/login", json={
            "email": "test2@example.com", "password": "wrong"
        })
        assert r.status_code == 401
