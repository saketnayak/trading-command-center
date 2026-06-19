import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.services.encryption import decrypt_key
from app.dependencies import get_current_user
from app.utils.llm_providers import LOCAL_LLM_PROVIDERS, PROVIDER_MODEL_CATALOG, normalize_llm_provider

router = APIRouter()


@router.get("/{provider}/models", response_model=list[str])
async def list_models(
    provider: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    try:
        provider = normalize_llm_provider(provider)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    if provider in PROVIDER_MODEL_CATALOG:
        return PROVIDER_MODEL_CATALOG[provider]

    if provider not in LOCAL_LLM_PROVIDERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown provider '{provider}'")

    row = (await db.execute(select(ApiKey).where(ApiKey.provider == provider))).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No URL configured for local provider '{provider}'")

    base_url = decrypt_key(row.encrypted_key).rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            if provider == "ollama":
                r = await client.get(f"{base_url}/api/tags")
                r.raise_for_status()
                return [m["name"] for m in r.json().get("models", [])]
            else:  # vllm
                r = await client.get(f"{base_url}/v1/models")
                r.raise_for_status()
                return [m["id"] for m in r.json().get("data", [])]
    except Exception as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not reach {provider} server: {exc}")
