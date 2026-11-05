"""Regression: a brand-new user's first GET /watchlist auto-creates the
watchlist and must return 200 with no items (it used to 500 because the
freshly created row's ``items`` relationship was lazy-loaded during
response serialisation, raising MissingGreenlet)."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from main import app


async def _register_and_login(client: AsyncClient) -> str:
    email = f"first-watchlist-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post("/auth/register", json={
        "email": email,
        "password": "password123",
        "name": "First Watchlist User",
    })
    assert r.status_code in (200, 201), r.text
    login = await client.post("/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


@pytest.mark.asyncio
async def test_first_get_watchlist_auto_creates_empty_watchlist():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client)
        headers = {"Authorization": f"Bearer {token}"}

        first = await client.get("/watchlist", headers=headers)
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["items"] == []

        # The second load hits the existing-row path and returns the same watchlist.
        second = await client.get("/watchlist", headers=headers)
        assert second.status_code == 200, second.text
        assert second.json()["id"] == body["id"]
        assert second.json()["items"] == []
