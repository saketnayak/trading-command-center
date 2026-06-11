from datetime import datetime, timezone
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.schemas.api_key import ApiKeyUpsertRequest, ApiKeyResponse
from app.services.encryption import encrypt_key, decrypt_key
from app.dependencies import require_admin

router = APIRouter()


def _mask(key: str) -> str:
    return key[:4] + "•" * (len(key) - 8) + key[-4:] if len(key) > 8 else "•" * len(key)

# Endpoint to list all API keys. Only returns masked keys for security.
@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    result = await db.execute(select(ApiKey))
    keys = result.scalars().all()
    return [ApiKeyResponse(
        provider=k.provider,
        is_valid=k.is_valid,
        validated_at=k.validated_at,
        masked_key=_mask(plain) if (plain := decrypt_key(k.encrypted_key)) else None,
    ) for k in keys]

# Upsert endpoint for API keys. If a key for the provider already exists, it will be updated. Otherwise, a new key will be created.
@router.post("", response_model=ApiKeyResponse)
async def upsert_api_key(req: ApiKeyUpsertRequest, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    result = await db.execute(select(ApiKey).where(ApiKey.provider == req.provider))
    existing = result.scalar_one_or_none()
    is_valid = await _validate_key(req.provider, req.key)
    now = datetime.now(timezone.utc)
    if existing:
        existing.encrypted_key = encrypt_key(req.key)
        existing.is_valid = is_valid
        existing.validated_at = now if is_valid else None
    else:
        db.add(ApiKey(
            provider=req.provider,
            encrypted_key=encrypt_key(req.key),
            is_valid=is_valid,
            validated_at=now if is_valid else None,
            created_by=admin.id,
        ))
    await db.commit()
    return ApiKeyResponse(provider=req.provider, is_valid=is_valid, validated_at=now if is_valid else None, masked_key=_mask(req.key))

# Endpoint to delete an API key by provider name.
@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(provider: str, db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    result = await db.execute(select(ApiKey).where(ApiKey.provider == provider))
    key = result.scalar_one_or_none()
    if key:
        await db.delete(key)
        await db.commit()

# Helper function to validate API keys by making a test call to the provider's API. Returns True if the key is valid.
async def _validate_key(provider: str, key: str) -> bool:
    """Test call to validate the key. Returns True if valid."""
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            if provider == "ionos":
                r = await client.get("https://openai.inference.de-txl.ionos.com/v1/models", 
                                     headers={"Authorization": f"Bearer {key}"}, 
                                     timeout=5)
                return r.status_code == 200
            if provider == "openai":
                r = await client.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=5)
                return r.status_code == 200
            if provider == "groq":
                r = await client.get("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=5)
                return r.status_code == 200
            if provider == "alpha_vantage":
                # TIME_SERIES_INTRADAY is now premium; use GLOBAL_QUOTE (free tier)
                r = await client.get(f"https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey={key}", timeout=5)
                data = r.json()
                info = (data.get("Information") or data.get("Note") or "").lower()
                if "demo" in info or "invalid api call" in info:
                    return False
                if "Global Quote" in data:
                    return True
                return r.status_code == 200
            if provider == "finnhub":
                r = await client.get(f"https://finnhub.io/api/v1/quote?symbol=AAPL&token={key}", timeout=5)
                if r.status_code in {401, 403}:
                    return False
                if r.status_code == 429:
                    return True  # rate-limited means key is real
                data = r.json()
                return r.status_code == 200 and not data.get("error")
            if provider == "ollama":
                r = await client.get(f"{key.rstrip('/')}/api/tags", timeout=5)
                return r.status_code == 200
            if provider == "vllm":
                r = await client.get(f"{key.rstrip('/')}/health", timeout=5)
                return r.status_code == 200
        return True  # unknown providers pass validation
    except Exception:
        return False
