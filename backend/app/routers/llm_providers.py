import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.services.encryption import decrypt_key
from app.services.llm_provider_registry import list_local_models
from app.dependencies import get_current_user
from app.utils.llm_providers import (
    DEFAULT_LLM_DEPTH,
    DEFAULT_LLM_MODELS,
    DEFAULT_LLM_PROVIDER,
    LOCAL_LLM_PROVIDERS,
    PROVIDER_MODEL_CATALOG,
    normalize_llm_provider,
)

router = APIRouter()


class LlmProviderDefaultsResponse(BaseModel):
    default_provider: str
    default_depth: str
    default_models: dict[str, str]


@router.get("/defaults", response_model=LlmProviderDefaultsResponse)
async def get_provider_defaults(
    _user: User = Depends(get_current_user),
) -> LlmProviderDefaultsResponse:
    return LlmProviderDefaultsResponse(
        default_provider=DEFAULT_LLM_PROVIDER,
        default_depth=DEFAULT_LLM_DEPTH,
        default_models=dict(DEFAULT_LLM_MODELS),
    )


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
            return await list_local_models(provider, base_url, client)
    except Exception as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not reach {provider} server: {exc}")
