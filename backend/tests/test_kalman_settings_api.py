import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from main import app


async def _register_and_token(client: AsyncClient, email: str) -> str:
    r = await client.post(
        "/auth/register",
        json={"email": email, "password": "pass1234", "name": "Test"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _set_user_role(email: str, role: UserRole) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one()
        user.role = role
        await db.commit()


@pytest.mark.asyncio
async def test_kalman_settings_defaults_and_admin_update():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_token(client, "kalman_admin@example.com")
        headers = {"Authorization": f"Bearer {token}"}

        r1 = await client.get("/kalman/settings", headers=headers)
        assert r1.status_code == 200
        assert r1.json()["observation_covariance"] == pytest.approx(0.1)
        assert r1.json()["transition_covariance"] == pytest.approx(0.01)
        assert r1.json()["processing_mode"] == "causal"

        r2 = await client.put(
            "/kalman/settings",
            json={
                "observation_covariance": 0.2,
                "transition_covariance": 0.02,
                "processing_mode": "historical",
            },
            headers=headers,
        )
        assert r2.status_code == 200
        assert r2.json()["observation_covariance"] == pytest.approx(0.2)
        assert r2.json()["transition_covariance"] == pytest.approx(0.02)
        assert r2.json()["processing_mode"] == "historical"


@pytest.mark.asyncio
async def test_kalman_settings_update_requires_admin():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_token(client, "kalman_member@example.com")
        await _set_user_role("kalman_member@example.com", UserRole.member)

        r = await client.put(
            "/kalman/settings",
            json={
                "observation_covariance": 0.2,
                "transition_covariance": 0.02,
                "processing_mode": "historical",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "Admin required"


@pytest.mark.asyncio
async def test_kalman_settings_rejects_out_of_range_values():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_token(client, "kalman_validation@example.com")
        r = await client.put(
            "/kalman/settings",
            json={
                "observation_covariance": 99,
                "transition_covariance": 0.02,
                "processing_mode": "causal",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 422
