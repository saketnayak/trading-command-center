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


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    result = await db.execute(select(ApiKey))
    keys = result.scalars().all()
    return [ApiKeyResponse(
        provider=k.provider,
        is_valid=k.is_valid,
        validated_at=k.validated_at,
        masked_key=_mask(decrypt_key(k.encrypted_key)),
    ) for k in keys]


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


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(provider: str, db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    result = await db.execute(select(ApiKey).where(ApiKey.provider == provider))
    key = result.scalar_one_or_none()
    if key:
        await db.delete(key)
        await db.commit()


async def _validate_key(provider: str, key: str) -> bool:
    """Test call to validate the key. Returns True if valid."""
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            if provider == "openai":
                r = await client.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=5)
                return r.status_code == 200
            if provider == "alpha_vantage":
                r = await client.get(f"https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min&apikey={key}", timeout=5)
                return "Time Series" in r.text or "Meta Data" in r.text
            if provider == "ollama":
                r = await client.get(f"{key}/api/tags", timeout=5)
                return r.status_code == 200
            if provider == "vllm":
                r = await client.get(f"{key}/health", timeout=5)
                return r.status_code == 200
        return True  # unknown providers pass validation
    except Exception:
        return False
