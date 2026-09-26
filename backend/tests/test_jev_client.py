import json

import httpx
import pytest

from app.services.jev_client import (
    GATEWAY_URL,
    TYPESAFE_DIRECT_URL,
    JevClient,
    JevDeadlineExceeded,
    JevDecisionError,
    JevGatewayVerificationRequired,
    JevRateLimited,
    MockJevClient,
    run_battery,
)
from jev_loop.battery import build_questions
from jev_loop.mock import MockDecisionModel

pytestmark = pytest.mark.unit

STATE = {"mid": 100.0, "inventory": 0.0, "imbalance": 0.1}


def _valid_answers() -> dict:
    return MockDecisionModel(seed=1).ask(STATE, build_questions())[0]


def _gateway() -> JevClient:
    return JevClient.gateway("vck_test")


async def test_gateway_request_shape_and_meta(httpx_mock):
    httpx_mock.add_response(
        url=GATEWAY_URL,
        method="POST",
        json={
            "model": "typesafe-ai/jev",
            "answers": _valid_answers(),
            "usage": {"input_tokens": 700, "output_tokens": 20},
            "provider_metadata": {"gateway": {"cost": "0.0000294"}},
        },
    )
    async with _gateway() as client:
        answers, meta = await run_battery(client, STATE, timeout=2.0)
    sent = httpx_mock.get_requests()[0]
    body = json.loads(sent.content)
    assert sent.headers["Authorization"] == "Bearer vck_test"
    assert body["model"] == "typesafe-ai/jev"
    assert body["state"] == STATE
    assert set(body["questions"]) == set(build_questions())
    assert meta["route"] == "Vercel AI Gateway"
    assert meta["model"] == "typesafe-ai/jev"
    assert meta["cost_usd"] == pytest.approx(0.0000294)
    assert meta["latency_ms"] >= 0
    assert "regime" in answers


async def test_direct_route_pins_jev_latest(httpx_mock):
    httpx_mock.add_response(url=TYPESAFE_DIRECT_URL, method="POST", json={"model": "jev-latest", "answers": _valid_answers()})
    async with JevClient.direct("ts_test") as client:
        _, meta = await run_battery(client, STATE, timeout=2.0)
    sent = json.loads(httpx_mock.get_requests()[0].content)
    assert sent["model"] == "jev-latest" and "providerOptions" not in sent
    assert meta["route"] == "TypeSafe direct"


async def test_a_429_is_reported_once_and_never_retried_inside_the_tick(httpx_mock):
    # Regression: retrying a provider 429 within the same tick tripled the load
    # (Vercel logs showed paired 429s in the same second).
    httpx_mock.add_response(url=GATEWAY_URL, method="POST", status_code=429, headers={"retry-after": "7"})
    async with _gateway() as client:
        with pytest.raises(JevRateLimited) as exc:
            await run_battery(client, STATE, timeout=2.0)
    assert len(httpx_mock.get_requests()) == 1
    assert exc.value.retry_after_s == 7.0


async def test_a_429_without_retry_after_has_no_hint(httpx_mock):
    httpx_mock.add_response(url=GATEWAY_URL, method="POST", status_code=429, json={"error": {"type": "rate_limit_exceeded"}})
    async with _gateway() as client:
        with pytest.raises(JevRateLimited) as exc:
            await run_battery(client, STATE, timeout=2.0)
    assert exc.value.retry_after_s is None


async def test_a_503_is_not_retried_inside_the_tick(httpx_mock):
    httpx_mock.add_response(url=GATEWAY_URL, method="POST", status_code=503, text="Service temporarily unavailable")
    async with _gateway() as client:
        with pytest.raises(JevDecisionError) as exc:
            await run_battery(client, STATE, timeout=2.0)
    assert not isinstance(exc.value, (JevRateLimited, JevDeadlineExceeded))
    assert len(httpx_mock.get_requests()) == 1


async def test_the_gateway_prefers_typesafe_and_reports_the_provider(httpx_mock):
    httpx_mock.add_response(
        url=GATEWAY_URL,
        method="POST",
        json={
            "model": "typesafe-ai/jev",
            "answers": _valid_answers(),
            "provider_metadata": {"gateway": {"routing": {"finalProvider": "digitalocean"}}},
        },
    )
    async with _gateway() as client:
        _, meta = await run_battery(client, STATE, timeout=2.0)
    body = json.loads(httpx_mock.get_requests()[0].content)
    assert body["providerOptions"] == {"gateway": {"order": ["typesafe-ai", "digitalocean"]}}
    assert meta["provider"] == "digitalocean"


@pytest.mark.parametrize(
    "payload",
    [
        {"error": {"type": "customer_verification_required", "message": "add a card"}},
        {"error_type": "customer_verification_required", "message": "add a card"},
    ],
)
async def test_gateway_card_on_file_403_is_its_own_error(httpx_mock, payload):
    httpx_mock.add_response(url=GATEWAY_URL, method="POST", status_code=403, json=payload)
    async with _gateway() as client:
        with pytest.raises(JevGatewayVerificationRequired):
            await run_battery(client, STATE, timeout=2.0)


async def test_other_errors_are_decision_errors(httpx_mock):
    httpx_mock.add_response(url=GATEWAY_URL, method="POST", status_code=400, json={"message": "bad", "error_type": "invalid_request"})
    async with _gateway() as client:
        with pytest.raises(JevDecisionError) as exc:
            await run_battery(client, STATE, timeout=2.0)
    assert not isinstance(exc.value, JevDeadlineExceeded)


async def test_timeout_is_a_deadline_miss_not_an_outage(httpx_mock):
    httpx_mock.add_exception(httpx.ReadTimeout("slow"), url=GATEWAY_URL, method="POST")
    async with _gateway() as client:
        with pytest.raises(JevDeadlineExceeded):
            await run_battery(client, STATE, timeout=0.5)


async def test_malformed_answers_are_rejected(httpx_mock):
    httpx_mock.add_response(url=GATEWAY_URL, method="POST", json={"model": "typesafe-ai/jev", "answers": {"regime": {}}})
    async with _gateway() as client:
        with pytest.raises(JevDecisionError):
            await run_battery(client, STATE, timeout=2.0)


async def test_mock_client_is_labelled_and_offline():
    client = MockJevClient(seed=7)
    answers, meta = await run_battery(client, STATE, timeout=2.0)
    assert client.is_mock and meta["route"] == "MOCK" and meta["model"].startswith("mock-")
    assert "regime" in answers
