import pytest
from httpx import AsyncClient, ASGITransport
from main import app


async def _register_and_token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234", "name": "Test"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _make_portfolio(client: AsyncClient, token: str) -> str:
    r = await client.post("/portfolio", json={"name": "Delivery Test"}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    return r.json()["id"]


@pytest.mark.asyncio
async def test_get_delivery_settings_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/portfolio/00000000-0000-0000-0000-000000000001/delivery-settings")
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_delivery_settings_returns_defaults():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "ds_defaults@example.com")
        portfolio_id = await _make_portfolio(c, token)
        r = await c.get(f"/portfolio/{portfolio_id}/delivery-settings", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        data = r.json()
        assert data["email_enabled"] is False
        assert data["webhook_enabled"] is False
        assert data["webhook_format"] == "json"


@pytest.mark.asyncio
async def test_put_delivery_settings_upsert():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "ds_upsert@example.com")
        portfolio_id = await _make_portfolio(c, token)
        headers = {"Authorization": f"Bearer {token}"}

        # First PUT creates a row
        r1 = await c.put(
            f"/portfolio/{portfolio_id}/delivery-settings",
            json={"email_enabled": True, "email_address": "me@example.com"},
            headers=headers,
        )
        assert r1.status_code == 200
        assert r1.json()["email_enabled"] is True
        assert r1.json()["email_address"] == "me@example.com"

        # Second PUT updates the same row
        r2 = await c.put(
            f"/portfolio/{portfolio_id}/delivery-settings",
            json={"email_enabled": False},
            headers=headers,
        )
        assert r2.status_code == 200
        assert r2.json()["email_enabled"] is False
        assert r2.json()["email_address"] == "me@example.com"  # unchanged


@pytest.mark.asyncio
async def test_put_delivery_settings_rejects_non_https_webhook():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "ds_http@example.com")
        portfolio_id = await _make_portfolio(c, token)
        r = await c.put(
            f"/portfolio/{portfolio_id}/delivery-settings",
            json={"webhook_url": "http://insecure.example.com/hook"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_test_webhook_returns_400_when_no_url():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "ds_nourl@example.com")
        portfolio_id = await _make_portfolio(c, token)
        r = await c.post(
            f"/portfolio/{portfolio_id}/delivery-settings/test-webhook",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400
        assert "No webhook URL" in r.json()["detail"]
