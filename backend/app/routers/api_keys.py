from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.schemas.api_key import ApiKeyUpsertRequest, ApiKeyResponse
from app.services.encryption import encrypt_key, decrypt_key
from app.services.finnhub_client import (
    FinnhubCapability,
    FinnhubReason,
    capabilities_summary,
    classify_response,
    probe_capabilities,
)
from app.dependencies import require_admin
import httpx

router = APIRouter()


def _mask(key: str) -> str:
    return key[:4] + "•" * (len(key) - 8) + key[-4:] if len(key) > 8 else "•" * len(key)


def _serialize_capabilities(raw: dict[str, Any] | None) -> dict[str, dict[str, Any]] | None:
    if not raw:
        return None
    return {
        key: {
            "ok": bool(value.get("ok")),
            "reason": value.get("reason"),
            "message": value.get("message"),
        }
        for key, value in raw.items()
    }


def _to_response(key: ApiKey, plain: str | None = None) -> ApiKeyResponse:
    return ApiKeyResponse(
        provider=key.provider,
        is_valid=key.is_valid,
        validated_at=key.validated_at,
        masked_key=_mask(plain) if plain else None,
        capabilities=_serialize_capabilities(key.capabilities),
        last_error_code=key.last_error_code,
        last_error_message=key.last_error_message,
        capabilities_checked_at=key.capabilities_checked_at,
    )


# Endpoint to list all API keys. Only returns masked keys for security.
@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    result = await db.execute(select(ApiKey))
    keys = result.scalars().all()
    return [
        _to_response(k, plain if (plain := decrypt_key(k.encrypted_key)) else None)
        for k in keys
    ]


# Upsert endpoint for API keys. If a key for the provider already exists, it will be updated. Otherwise, a new key will be created.
@router.post("", response_model=ApiKeyResponse)
async def upsert_api_key(req: ApiKeyUpsertRequest, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(ApiKey).where(ApiKey.provider == req.provider))
    existing = result.scalar_one_or_none()
    validation = await _validate_key(req.provider, req.key)
    is_valid = validation["is_valid"]
    now = datetime.now(timezone.utc)
    capabilities = validation.get("capabilities")
    last_error_code = validation.get("last_error_code")
    last_error_message = validation.get("last_error_message")
    capabilities_checked_at = now if capabilities is not None else None

    if existing:
        existing.encrypted_key = encrypt_key(req.key)
        existing.is_valid = is_valid
        existing.validated_at = now if is_valid else None
        existing.capabilities = capabilities
        existing.last_error_code = last_error_code
        existing.last_error_message = last_error_message
        existing.capabilities_checked_at = capabilities_checked_at
        key_row = existing
    else:
        key_row = ApiKey(
            provider=req.provider,
            encrypted_key=encrypt_key(req.key),
            is_valid=is_valid,
            validated_at=now if is_valid else None,
            capabilities=capabilities,
            last_error_code=last_error_code,
            last_error_message=last_error_message,
            capabilities_checked_at=capabilities_checked_at,
            created_by=admin.id,
        )
        db.add(key_row)
    await db.commit()
    await db.refresh(key_row)
    return _to_response(key_row, req.key)


# Endpoint to delete an API key by provider name.
@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(provider: str, db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    result = await db.execute(select(ApiKey).where(ApiKey.provider == provider))
    key = result.scalar_one_or_none()
    if key:
        await db.delete(key)
        await db.commit()


# Helper function to validate API keys by making a test call to the provider's API.
async def _validate_key(provider: str, key: str) -> dict[str, Any]:
    """Test call to validate the key. Returns validation metadata."""
    try:
        async with httpx.AsyncClient() as client:
            if provider == "ionos":
                r = await client.get(
                    "https://openai.inference.de-txl.ionos.com/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                    timeout=5,
                )
                return {"is_valid": r.status_code == 200}
            if provider == "openai":
                r = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                    timeout=5,
                )
                return {"is_valid": r.status_code == 200}
            if provider == "groq":
                r = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                    timeout=5,
                )
                return {"is_valid": r.status_code == 200}
            if provider == "alpha_vantage":
                r = await client.get(
                    f"https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey={key}",
                    timeout=5,
                )
                data = r.json()
                info = (data.get("Information") or data.get("Note") or "").lower()
                if "demo" in info or "invalid api call" in info:
                    return {"is_valid": False}
                if "Global Quote" in data:
                    return {"is_valid": True}
                return {"is_valid": r.status_code == 200}
            if provider == "finnhub":
                r = await client.get(
                    "https://finnhub.io/api/v1/quote",
                    params={"symbol": "AAPL", "token": key},
                    timeout=5,
                )
                if r.status_code == 429:
                    capabilities = await probe_capabilities(key)
                    code, message = capabilities_summary(capabilities)
                    return {
                        "is_valid": True,
                        "capabilities": capabilities,
                        "last_error_code": code,
                        "last_error_message": message,
                    }
                quote_error = classify_response(r, FinnhubCapability.QUOTE)
                if quote_error and quote_error.reason == FinnhubReason.INVALID_KEY:
                    return {"is_valid": False}
                if quote_error and quote_error.reason in {
                    FinnhubReason.ACCESS_DENIED,
                    FinnhubReason.PREMIUM_REQUIRED,
                }:
                    return {
                        "is_valid": False,
                        "last_error_code": quote_error.reason.value,
                        "last_error_message": quote_error.message,
                    }
                capabilities = await probe_capabilities(key)
                code, message = capabilities_summary(capabilities)
                return {
                    "is_valid": True,
                    "capabilities": capabilities,
                    "last_error_code": code,
                    "last_error_message": message,
                }
            if provider == "ollama":
                r = await client.get(f"{key.rstrip('/')}/api/tags", timeout=5)
                return {"is_valid": r.status_code == 200}
            if provider == "vllm":
                r = await client.get(f"{key.rstrip('/')}/health", timeout=5)
                return {"is_valid": r.status_code == 200}
        return {"is_valid": True}
    except Exception:
        return {"is_valid": False}
