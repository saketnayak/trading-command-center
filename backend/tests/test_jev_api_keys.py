import json

import pytest
from httpx import ASGITransport, AsyncClient

from main import app

ALPACA_ACCOUNT_URL = "https://paper-api.alpaca.markets/v2/account"
GATEWAY_SYSTEMONE_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone"
TYPESAFE_SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone"

ALPACA_SECRET = "s3cr3t-value-that-must-never-leak"


def _alpaca(key_id: str = "PKTESTKEY123456", secret: str = ALPACA_SECRET) -> str:
    return json.dumps({"key_id": key_id, "secret": secret})


async def _upsert(provider: str, key: str) -> dict:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/auth/register", json={"email": "jevkeys@example.com", "password": "pass1234", "name": "A"})
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = await client.post("/api-keys", json={"provider": provider, "key": key}, headers=headers)
        assert r.status_code == 200, r.text
        return r.json()


@pytest.mark.asyncio
async def test_alpaca_paper_key_is_validated_against_the_paper_account(httpx_mock):
    httpx_mock.add_response(url=ALPACA_ACCOUNT_URL, status_code=200, json={"status": "ACTIVE"})
    body = await _upsert("alpaca_paper", _alpaca())
    assert body["is_valid"] is True
    sent = httpx_mock.get_requests()[0]
    assert sent.headers["APCA-API-KEY-ID"] == "PKTESTKEY123456"
    assert sent.headers["APCA-API-SECRET-KEY"] == ALPACA_SECRET


@pytest.mark.asyncio
async def test_alpaca_secret_never_appears_in_the_response(httpx_mock):
    httpx_mock.add_response(url=ALPACA_ACCOUNT_URL, status_code=200, json={})
    body = await _upsert("alpaca_paper", _alpaca())
    assert ALPACA_SECRET not in json.dumps(body)
    assert body["masked_key"].startswith("PKTE")


@pytest.mark.asyncio
async def test_alpaca_live_key_is_refused_without_calling_alpaca(httpx_mock):
    body = await _upsert("alpaca_paper", _alpaca(key_id="AKLIVEKEY123456"))
    assert body["is_valid"] is False
    assert "paper" in body["last_error_message"].lower()
    assert httpx_mock.get_requests() == []


@pytest.mark.asyncio
async def test_alpaca_key_that_is_not_the_expected_json_is_invalid(httpx_mock):
    body = await _upsert("alpaca_paper", "PKjust-a-key-id")
    assert body["is_valid"] is False
    assert httpx_mock.get_requests() == []


@pytest.mark.asyncio
async def test_alpaca_401_is_invalid(httpx_mock):
    httpx_mock.add_response(url=ALPACA_ACCOUNT_URL, status_code=401)
    assert (await _upsert("alpaca_paper", _alpaca()))["is_valid"] is False


@pytest.mark.asyncio
async def test_ai_gateway_key_is_validated_with_one_tiny_jev_decision(httpx_mock):
    # Regression: the free models listing accepted a key whose team had no card,
    # so the problem only surfaced once a paper session was running.
    httpx_mock.add_response(url=GATEWAY_SYSTEMONE_URL, method="POST", status_code=200,
                            json={"model": "typesafe-ai/jev", "answers": {"ok": {"type": "noul", "noul": 0.9}}})
    body = await _upsert("ai_gateway", "vck_testkey_123456")
    assert body["is_valid"] is True and not body["last_error_message"]
    sent = httpx_mock.get_requests()[0]
    assert sent.headers["Authorization"] == "Bearer vck_testkey_123456"
    assert json.loads(sent.content)["model"] == "typesafe-ai/jev"


@pytest.mark.asyncio
async def test_ai_gateway_key_without_a_card_is_invalid_with_the_reason(httpx_mock):
    httpx_mock.add_response(url=GATEWAY_SYSTEMONE_URL, method="POST", status_code=403,
                            json={"error": {"type": "customer_verification_required", "message": "add a card"}})
    body = await _upsert("ai_gateway", "vck_nocard_123456")
    assert body["is_valid"] is False and "card" in body["last_error_message"].lower()


@pytest.mark.asyncio
async def test_a_busy_jev_provider_does_not_reject_a_good_key(httpx_mock):
    httpx_mock.add_response(url=GATEWAY_SYSTEMONE_URL, method="POST", status_code=429)
    body = await _upsert("ai_gateway", "vck_busy_123456")
    assert body["is_valid"] is True and "busy" in body["last_error_message"].lower()


@pytest.mark.asyncio
async def test_ai_gateway_bad_key_is_invalid(httpx_mock):
    httpx_mock.add_response(url=GATEWAY_SYSTEMONE_URL, method="POST", status_code=401)
    assert (await _upsert("ai_gateway", "vck_bad_key_123456"))["is_valid"] is False


@pytest.mark.asyncio
async def test_typesafe_direct_key_is_validated_with_one_tiny_decision(httpx_mock):
    httpx_mock.add_response(
        url=TYPESAFE_SYSTEMONE_URL,
        method="POST",
        status_code=200,
        json={"model": "jev-latest", "answers": {"ok": {"type": "noul", "noul": 0.9}}},
    )
    assert (await _upsert("typesafe", "ts_testkey_123456"))["is_valid"] is True
    sent = json.loads(httpx_mock.get_requests()[0].content)
    assert sent["model"] == "jev-latest" and len(sent["questions"]) == 1
