import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.services.encryption import decrypt_key
from app.dependencies import get_current_user
from app.utils.llm_providers import LOCAL_LLM_PROVIDERS, normalize_llm_provider

router = APIRouter()

_STATIC_MODELS: dict[str, list[str]] = {
    "openai": [
        "gpt-5.5", "gpt-5.5-pro",
        "gpt-5.4-mini", "gpt-5.4-nano",
        "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
        "o3-pro", "o3", "o4-mini",
        "gpt-4o", "gpt-4o-mini",
        ],
    "ionos": [
        "meta-llama/Meta-Llama-3.1-405B-Instruct-FP8",
        "openai/gpt-oss-120b",
        "meta-llama/Llama-3.3-70B-Instruct",
    ],
    "anthropic": [
        "claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
        "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022",
    ],
    "google": [
        "gemini-3.5-flash",
        "gemini-3.1-pro-preview", "gemini-3-flash-preview",
        "gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview",
        "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
        "gemini-2.0-flash", "gemini-2.0-flash-lite",
    ],
    "groq": [
        "meta-llama/llama-4-maverick-17b-128e-instruct",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "deepseek-r1-distill-llama-70b",
        "qwen-qwq-32b",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
        "compound-beta",
    ],
}


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

    if provider in _STATIC_MODELS:
        return _STATIC_MODELS[provider]

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
