import pytest
from httpx import ASGITransport, AsyncClient

from main import app

_BASE = {
    "observation_covariance": 0.1,
    "transition_covariance": 0.01,
    "processing_mode": "causal",
    "enable_kalman_filter": True,
    "enable_elliott_wave": True,
    "enable_markov_regime": True,
}


async def _admin_headers(client: AsyncClient) -> dict:
    r = await client.post("/auth/register", json={"email": "jevflag@example.com", "password": "pass1234", "name": "A"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_jev_loop_is_off_by_default():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/settings", headers=await _admin_headers(client))
        assert r.status_code == 200
        assert r.json()["enable_jev_loop"] is False


@pytest.mark.asyncio
async def test_admin_can_enable_jev_loop():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _admin_headers(client)
        r = await client.put("/settings", json={**_BASE, "enable_jev_loop": True}, headers=headers)
        assert r.status_code == 200
        assert r.json()["enable_jev_loop"] is True


@pytest.mark.asyncio
async def test_saving_other_settings_without_the_flag_leaves_it_unchanged():
    # Existing clients that don't know about the flag must not flip it.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _admin_headers(client)
        await client.put("/settings", json={**_BASE, "enable_jev_loop": True}, headers=headers)
        r = await client.put("/settings", json={**_BASE, "enable_kalman_filter": False}, headers=headers)
        assert r.status_code == 200
        assert r.json()["enable_jev_loop"] is True
        assert r.json()["enable_kalman_filter"] is False
