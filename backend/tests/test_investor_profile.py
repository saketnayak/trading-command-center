import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from app.services.auth import create_invite_token


async def _register_and_token(client: AsyncClient, email: str = "test@example.com") -> str:
    r = await client.post("/auth/register", json={
        "email": email, "password": "pass1234", "name": "Test User"
    })
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_get_profile_returns_null_when_none_exists():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c)
        r = await c.get("/investor-profile/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json() is None


@pytest.mark.asyncio
async def test_upsert_creates_profile():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c)
        headers = {"Authorization": f"Bearer {token}"}
        r = await c.put("/investor-profile/me", json={
            "time_horizon": "7_15y",
            "risk_willingness": 4,
            "investment_style": "active",
        }, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["time_horizon"] == "7_15y"
        assert data["risk_willingness"] == 4
        assert data["investment_style"] == "active"
        assert data["user_id"] is not None


@pytest.mark.asyncio
async def test_upsert_updates_existing_profile():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c)
        headers = {"Authorization": f"Bearer {token}"}
        await c.put("/investor-profile/me", json={"time_horizon": "lt_1y"}, headers=headers)
        r = await c.put("/investor-profile/me", json={"time_horizon": "gt_15y", "risk_willingness": 2}, headers=headers)
        assert r.status_code == 200
        assert r.json()["time_horizon"] == "gt_15y"
        assert r.json()["risk_willingness"] == 2


@pytest.mark.asyncio
async def test_get_profile_returns_saved_data():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c)
        headers = {"Authorization": f"Bearer {token}"}
        await c.put("/investor-profile/me", json={
            "anti_portfolio": ["gambling", "tobacco"],
            "blind_spots": "Hold losers too long",
        }, headers=headers)
        r = await c.get("/investor-profile/me", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["anti_portfolio"] == ["gambling", "tobacco"]
        assert data["blind_spots"] == "Hold losers too long"


@pytest.mark.asyncio
async def test_delete_profile():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c)
        headers = {"Authorization": f"Bearer {token}"}
        await c.put("/investor-profile/me", json={"time_horizon": "7_15y"}, headers=headers)
        r = await c.delete("/investor-profile/me", headers=headers)
        assert r.status_code == 204
        r2 = await c.get("/investor-profile/me", headers=headers)
        assert r2.json() is None


@pytest.mark.asyncio
async def test_profile_is_user_scoped():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token_a = await _register_and_token(c, "a@example.com")
        invite = create_invite_token("b@example.com")
        r_b = await c.post("/auth/register", json={
            "email": "b@example.com", "password": "pass1234", "name": "User B",
            "invite_token": invite,
        })
        token_b = r_b.json()["access_token"]
        await c.put("/investor-profile/me", json={"time_horizon": "lt_1y"},
                    headers={"Authorization": f"Bearer {token_a}"})
        r = await c.get("/investor-profile/me", headers={"Authorization": f"Bearer {token_b}"})
        assert r.json() is None


@pytest.mark.asyncio
async def test_unauthenticated_returns_401():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/investor-profile/me")
        assert r.status_code == 401
