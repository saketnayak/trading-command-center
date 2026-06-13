import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch
from main import app


async def _admin_token(client):
    await client.post("/auth/register", json={"email": "keys@test.com", "password": "password1", "name": "Keys"})
    r = await client.post("/auth/login", json={"email": "keys@test.com", "password": "password1"})
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_upsert_ollama_url_marks_valid_when_server_responds(httpx_mock):
    httpx_mock.add_response(url="http://localhost:11434/api/tags", status_code=200, json={"models": []})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _admin_token(client)
        r = await client.post(
            "/api-keys",
            json={"provider": "ollama", "key": "http://localhost:11434"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json()["is_valid"] is True


@pytest.mark.asyncio
async def test_upsert_ollama_url_marks_invalid_when_server_down(httpx_mock):
    httpx_mock.add_exception(Exception("connection refused"), url="http://localhost:11435/api/tags")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _admin_token(client)
        r = await client.post(
            "/api-keys",
            json={"provider": "ollama", "key": "http://localhost:11435"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json()["is_valid"] is False


@pytest.mark.asyncio
async def test_upsert_vllm_url_marks_valid_when_server_responds(httpx_mock):
    httpx_mock.add_response(url="http://localhost:8080/health", status_code=200)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _admin_token(client)
        r = await client.post(
            "/api-keys",
            json={"provider": "vllm", "key": "http://localhost:8080"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json()["is_valid"] is True


@pytest.mark.asyncio
async def test_upsert_vllm_url_marks_invalid_when_server_down(httpx_mock):
    httpx_mock.add_exception(Exception("connection refused"), url="http://localhost:8081/health")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _admin_token(client)
        r = await client.post(
            "/api-keys",
            json={"provider": "vllm", "key": "http://localhost:8081"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json()["is_valid"] is False


@pytest.mark.asyncio
async def test_upsert_finnhub_key_accepts_authorized_empty_quote(httpx_mock):
    httpx_mock.add_response(
        url="https://finnhub.io/api/v1/quote?symbol=AAPL&token=valid-finnhub",
        status_code=200,
        json={"c": 0, "d": None, "dp": None, "h": 0, "l": 0, "o": 0, "pc": 0},
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _admin_token(client)
        with patch(
            "app.routers.api_keys.probe_capabilities",
            new=AsyncMock(return_value={"quote": {"ok": True}}),
        ):
            r = await client.post(
                "/api-keys",
                json={"provider": "finnhub", "key": "valid-finnhub"},
                headers={"Authorization": f"Bearer {token}"},
            )

    assert r.status_code == 200
    assert r.json()["is_valid"] is True
