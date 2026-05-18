import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.mark.asyncio
async def test_behavioral_alerts_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/portfolio/00000000-0000-0000-0000-000000000001/behavioral-alerts")
        assert r.status_code == 401
