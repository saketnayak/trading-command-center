"""Async Jev decision clients: TypeSafe direct, Vercel AI Gateway, or mock.

Resolution order: a valid `typesafe` key (one fewer hop), then a valid
`ai_gateway` key, then the clearly-labelled mock. Every response records
the model that actually answered, because confidence thresholds are
calibrated to one model and a silent upgrade breaks them quietly.
"""

from __future__ import annotations

import asyncio
import random
import time

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import ApiKey
from app.services.encryption import decrypt_key
from jev_loop.battery import build_questions, validate_answers
from jev_loop.mock import MockDecisionModel

TYPESAFE_DIRECT_URL = "https://api.typesafe.ai/v1/systemone"
GATEWAY_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone"

_RETRYABLE_STATUS = {429, 529}
_MAX_RETRIES = 2


class JevDecisionError(Exception):
    """Jev could not answer (the loop drops to the RULES_ONLY rung)."""


class JevDeadlineExceeded(JevDecisionError):
    """The answer did not arrive inside the tick budget (HOLD_LATE rung)."""


class JevGatewayVerificationRequired(JevDecisionError):
    """Vercel wants a card on file before the gateway serves requests."""


def _error_type(resp: httpx.Response) -> tuple[str | None, str]:
    try:
        payload = resp.json()
    except ValueError:
        return None, resp.text[:300]
    if not isinstance(payload, dict):
        return None, resp.text[:300]
    err = payload.get("error")
    if isinstance(err, dict):
        return err.get("type"), str(err.get("message", ""))
    return payload.get("error_type"), str(payload.get("message", ""))


class JevClient:
    is_mock = False

    def __init__(self, name: str, url: str, model: str, api_key: str, backoff_base_s: float = 0.35):
        self.name = name
        self.model = model
        self._url = url
        self._headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        self._backoff_base_s = backoff_base_s
        self._http = httpx.AsyncClient()

    @classmethod
    def direct(cls, api_key: str, **kw) -> "JevClient":
        return cls("TypeSafe direct", TYPESAFE_DIRECT_URL, "jev-latest", api_key, **kw)

    @classmethod
    def gateway(cls, api_key: str, **kw) -> "JevClient":
        return cls("Vercel AI Gateway", GATEWAY_URL, "typesafe-ai/jev", api_key, **kw)

    async def __aenter__(self) -> "JevClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    async def ask(self, state: dict, questions: dict, timeout: float) -> tuple[dict, dict]:
        started = time.monotonic()
        deadline = started + timeout
        body = {"model": self.model, "state": state, "questions": questions}
        attempt = 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise JevDeadlineExceeded("tick budget spent before Jev answered")
            try:
                resp = await self._http.post(self._url, headers=self._headers, json=body, timeout=remaining)
            except httpx.TimeoutException as exc:
                raise JevDeadlineExceeded(f"Jev timed out: {exc}") from exc
            except httpx.HTTPError as exc:
                resp, error = None, exc
            else:
                error = None

            if resp is not None:
                if resp.status_code == 200:
                    data = resp.json()
                    gateway_meta = (data.get("provider_metadata") or {}).get("gateway") or {}
                    cost = gateway_meta.get("cost")
                    return data.get("answers") or {}, {
                        "route": self.name,
                        "model": data.get("model", self.model),
                        "latency_ms": round((time.monotonic() - started) * 1000, 1),
                        "usage": data.get("usage") or {},
                        "cost_usd": float(cost) if cost is not None else None,
                    }
                err_type, message = _error_type(resp)
                if resp.status_code == 403 and err_type == "customer_verification_required":
                    raise JevGatewayVerificationRequired(message or "add a card on file in Vercel")
                if resp.status_code not in _RETRYABLE_STATUS:
                    raise JevDecisionError(f"HTTP {resp.status_code}: {message}")

            attempt += 1
            if attempt > _MAX_RETRIES:
                raise JevDecisionError(f"gave up after {_MAX_RETRIES} retries: {error or resp.status_code}")
            backoff = self._backoff_base_s * (2 ** (attempt - 1)) + random.uniform(0, 0.1 * self._backoff_base_s)
            if backoff >= deadline - time.monotonic():
                raise JevDeadlineExceeded("tick budget spent during retry backoff")
            await asyncio.sleep(backoff)


class MockJevClient:
    """Offline, seeded stand-in. Sessions on the mock never place orders."""

    is_mock = True
    name = MockDecisionModel.name
    model = MockDecisionModel.model

    def __init__(self, seed: int | None = None, max_position_usd: float = 50.0):
        self._model = MockDecisionModel(seed=seed, max_position_usd=max_position_usd)

    async def ask(self, state: dict, questions: dict, timeout: float) -> tuple[dict, dict]:
        started = time.monotonic()
        answers, meta = self._model.ask(state, questions)
        meta.update(latency_ms=round((time.monotonic() - started) * 1000, 1), cost_usd=None)
        return answers, meta

    async def aclose(self) -> None:
        return None


async def run_battery(client, state: dict, timeout: float) -> tuple[dict, dict]:
    """Fire the seven-question battery once and validate the answers."""
    answers, meta = await client.ask(state, build_questions(), timeout)
    try:
        validate_answers(answers)
    except ValueError as exc:
        raise JevDecisionError(f"malformed battery response: {exc}") from exc
    return answers, meta


async def _valid_key(db: AsyncSession, provider: str) -> str | None:
    row = (await db.execute(select(ApiKey).where(ApiKey.provider == provider))).scalar_one_or_none()
    if row is None or not row.is_valid:
        return None
    return decrypt_key(row.encrypted_key)


async def resolve_jev_client(db: AsyncSession, force_mock: bool = False, max_position_usd: float = 50.0):
    if not force_mock:
        if key := await _valid_key(db, "typesafe"):
            return JevClient.direct(key)
        if key := await _valid_key(db, "ai_gateway"):
            return JevClient.gateway(key)
    return MockJevClient(max_position_usd=max_position_usd)
