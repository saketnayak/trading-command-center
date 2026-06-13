"""Shared Finnhub HTTP client with entitlement/error classification."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import ApiKey
from app.services.encryption import decrypt_key

logger = logging.getLogger(__name__)

BASE_URL = "https://finnhub.io/api/v1"


class FinnhubCapability(str, Enum):
    QUOTE = "quote"
    STOCK_CANDLE = "stock_candle"
    STOCK_METRIC = "stock_metric"
    COMPANY_NEWS = "company_news"
    EARNINGS_CALENDAR = "earnings_calendar"
    STOCK_PROFILE = "stock_profile"
    CRYPTO_CANDLE = "crypto_candle"


class FinnhubReason(str, Enum):
    NO_KEY = "no_finnhub_key"
    INVALID_KEY = "invalid_key"
    ACCESS_DENIED = "access_denied"
    PREMIUM_REQUIRED = "premium_required"
    RATE_LIMITED = "rate_limited"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    MALFORMED_RESPONSE = "malformed_response"


_PREMIUM_PATTERNS = re.compile(
    r"premium|subscription|upgrade|paid|not included|higher tier",
    re.IGNORECASE,
)
_ACCESS_PATTERNS = re.compile(
    r"don't have access|do not have access|access to this resource|forbidden|not authorized",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class FinnhubError:
    capability: FinnhubCapability
    reason: FinnhubReason
    message: str
    status_code: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "capability": self.capability.value,
            "reason": self.reason.value,
            "message": self.message,
            "status_code": self.status_code,
        }


@dataclass(frozen=True)
class FinnhubCapabilityStatus:
    ok: bool
    reason: str | None = None
    message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "reason": self.reason,
            "message": self.message,
        }


def user_message_for_reason(reason: FinnhubReason, capability: FinnhubCapability) -> str:
    labels = {
        FinnhubCapability.QUOTE: "live quotes",
        FinnhubCapability.STOCK_CANDLE: "historical stock candles",
        FinnhubCapability.STOCK_METRIC: "fundamentals",
        FinnhubCapability.COMPANY_NEWS: "company news",
        FinnhubCapability.EARNINGS_CALENDAR: "earnings calendar",
        FinnhubCapability.STOCK_PROFILE: "company profiles",
        FinnhubCapability.CRYPTO_CANDLE: "crypto candles",
    }
    feature = labels.get(capability, capability.value.replace("_", " "))
    if reason == FinnhubReason.NO_KEY:
        return "Add a Finnhub API key in Settings."
    if reason == FinnhubReason.INVALID_KEY:
        return "Your Finnhub API key is invalid. Update it in Settings."
    if reason == FinnhubReason.PREMIUM_REQUIRED:
        return f"Your Finnhub plan does not include {feature}. Upgrade to Premium Access on Finnhub."
    if reason == FinnhubReason.ACCESS_DENIED:
        return f"Your Finnhub API key cannot access {feature}."
    if reason == FinnhubReason.RATE_LIMITED:
        return "Finnhub rate limit reached. Try again shortly."
    if reason == FinnhubReason.PROVIDER_UNAVAILABLE:
        return "Finnhub is temporarily unavailable."
    return f"Could not load {feature} from Finnhub."


def classify_http_status(status_code: int, body_text: str = "") -> FinnhubReason:
    if status_code == 401:
        return FinnhubReason.INVALID_KEY
    if status_code == 403:
        if _PREMIUM_PATTERNS.search(body_text):
            return FinnhubReason.PREMIUM_REQUIRED
        return FinnhubReason.ACCESS_DENIED
    if status_code == 429:
        return FinnhubReason.RATE_LIMITED
    if status_code >= 500:
        return FinnhubReason.PROVIDER_UNAVAILABLE
    return FinnhubReason.MALFORMED_RESPONSE


def classify_error_body(body: Any) -> FinnhubReason | None:
    if body is None:
        return None
    if isinstance(body, dict):
        err = body.get("error") or body.get("message") or body.get("detail")
        if not err:
            return None
        text = str(err)
        if _PREMIUM_PATTERNS.search(text):
            return FinnhubReason.PREMIUM_REQUIRED
        if _ACCESS_PATTERNS.search(text) or "invalid" in text.lower():
            return FinnhubReason.ACCESS_DENIED
        return FinnhubReason.ACCESS_DENIED
    if isinstance(body, str) and body.strip():
        if _PREMIUM_PATTERNS.search(body):
            return FinnhubReason.PREMIUM_REQUIRED
        if _ACCESS_PATTERNS.search(body):
            return FinnhubReason.ACCESS_DENIED
    return None


def classify_response(
    response: httpx.Response,
    capability: FinnhubCapability,
) -> FinnhubError | None:
    body_text = response.text or ""
    if response.status_code >= 400:
        reason = classify_http_status(response.status_code, body_text)
        return FinnhubError(
            capability=capability,
            reason=reason,
            message=user_message_for_reason(reason, capability),
            status_code=response.status_code,
        )
    try:
        data = response.json()
    except Exception:
        return FinnhubError(
            capability=capability,
            reason=FinnhubReason.MALFORMED_RESPONSE,
            message=user_message_for_reason(FinnhubReason.MALFORMED_RESPONSE, capability),
            status_code=response.status_code,
        )
    body_reason = classify_error_body(data)
    if body_reason:
        return FinnhubError(
            capability=capability,
            reason=body_reason,
            message=user_message_for_reason(body_reason, capability),
            status_code=response.status_code,
        )
    return None


def should_cache_error(error: FinnhubError) -> bool:
    """Only cache transient failures briefly; never cache entitlement failures."""
    return error.reason == FinnhubReason.RATE_LIMITED


def aggregate_unavailable_reason(errors: list[FinnhubError | None]) -> str | None:
    """Pick the strongest user-facing reason from parallel fetches."""
    present = {e.reason for e in errors if e is not None}
    if not present:
        return None
    priority = [
        FinnhubReason.INVALID_KEY,
        FinnhubReason.NO_KEY,
        FinnhubReason.PREMIUM_REQUIRED,
        FinnhubReason.ACCESS_DENIED,
        FinnhubReason.RATE_LIMITED,
        FinnhubReason.PROVIDER_UNAVAILABLE,
        FinnhubReason.MALFORMED_RESPONSE,
    ]
    for reason in priority:
        if reason in present:
            return reason.value
    return next(iter(present)).value


async def get_finnhub_key(db: AsyncSession) -> Optional[str]:
    result = await db.execute(select(ApiKey).where(ApiKey.provider == "finnhub"))
    row = result.scalar_one_or_none()
    if not row:
        return None
    return decrypt_key(row.encrypted_key)


async def fetch_json(
    path: str,
    api_key: str,
    capability: FinnhubCapability,
    *,
    params: dict[str, Any] | None = None,
    client: httpx.AsyncClient | None = None,
    timeout: float = 8,
) -> tuple[Any, FinnhubError | None]:
    query = dict(params or {})
    query["token"] = api_key
    url = f"{BASE_URL}{path}"

    async def _do_request(c: httpx.AsyncClient) -> tuple[Any, FinnhubError | None]:
        try:
            response = await c.get(url, params=query)
        except httpx.TimeoutException:
            err = FinnhubError(
                capability=capability,
                reason=FinnhubReason.PROVIDER_UNAVAILABLE,
                message=user_message_for_reason(FinnhubReason.PROVIDER_UNAVAILABLE, capability),
            )
            logger.warning("finnhub timeout capability=%s path=%s", capability.value, path)
            return None, err
        except httpx.HTTPError as exc:
            err = FinnhubError(
                capability=capability,
                reason=FinnhubReason.PROVIDER_UNAVAILABLE,
                message=user_message_for_reason(FinnhubReason.PROVIDER_UNAVAILABLE, capability),
            )
            logger.warning(
                "finnhub http error capability=%s path=%s error=%s",
                capability.value,
                path,
                exc,
            )
            return None, err

        error = classify_response(response, capability)
        if error:
            logger.info(
                "finnhub access failure capability=%s path=%s status=%s reason=%s",
                capability.value,
                path,
                response.status_code,
                error.reason.value,
            )
            return None, error
        try:
            return response.json(), None
        except Exception:
            err = FinnhubError(
                capability=capability,
                reason=FinnhubReason.MALFORMED_RESPONSE,
                message=user_message_for_reason(FinnhubReason.MALFORMED_RESPONSE, capability),
                status_code=response.status_code,
            )
            return None, err

    if client is not None:
        return await _do_request(client)
    async with httpx.AsyncClient(timeout=timeout) as c:
        return await _do_request(c)


async def probe_capabilities(api_key: str) -> dict[str, dict[str, Any]]:
    """Probe Finnhub endpoints and return per-capability status for Settings."""
    today = date.today()
    probes: list[tuple[FinnhubCapability, str, dict[str, Any]]] = [
        (FinnhubCapability.QUOTE, "/quote", {"symbol": "AAPL"}),
        (FinnhubCapability.STOCK_PROFILE, "/stock/profile2", {"symbol": "AAPL"}),
        (FinnhubCapability.STOCK_METRIC, "/stock/metric", {"symbol": "AAPL", "metric": "all"}),
        (
            FinnhubCapability.COMPANY_NEWS,
            "/company-news",
            {"symbol": "AAPL", "from": today - timedelta(days=7), "to": today},
        ),
        (
            FinnhubCapability.EARNINGS_CALENDAR,
            "/calendar/earnings",
            {"from": today, "to": today + timedelta(days=7), "symbol": "AAPL"},
        ),
        (
            FinnhubCapability.STOCK_CANDLE,
            "/stock/candle",
            {
                "symbol": "AAPL",
                "resolution": "D",
                "from": int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp()),
                "to": int(datetime.now(timezone.utc).timestamp()),
            },
        ),
    ]

    results: dict[str, dict[str, Any]] = {}
    async with httpx.AsyncClient(timeout=5) as client:
        for capability, path, params in probes:
            _, error = await fetch_json(
                path,
                api_key,
                capability,
                params=params,
                client=client,
            )
            if error is None:
                results[capability.value] = FinnhubCapabilityStatus(ok=True).to_dict()
            else:
                results[capability.value] = FinnhubCapabilityStatus(
                    ok=False,
                    reason=error.reason.value,
                    message=error.message,
                ).to_dict()
    return results


def capabilities_summary(capabilities: dict[str, dict[str, Any]] | None) -> tuple[str | None, str | None]:
    if not capabilities:
        return None, None
    denied = [
        v for v in capabilities.values()
        if not v.get("ok") and v.get("reason") in {
            FinnhubReason.PREMIUM_REQUIRED.value,
            FinnhubReason.ACCESS_DENIED.value,
            FinnhubReason.INVALID_KEY.value,
        }
    ]
    if not denied:
        return None, None
    premium = [v for v in denied if v.get("reason") == FinnhubReason.PREMIUM_REQUIRED.value]
    if premium:
        return FinnhubReason.PREMIUM_REQUIRED.value, premium[0].get("message")
    return denied[0].get("reason"), denied[0].get("message")
