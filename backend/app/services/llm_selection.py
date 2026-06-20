"""Resolve LLM provider/model for a user."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import ApiKey
from app.models.user import User
from app.utils.llm_providers import DEFAULT_LLM_MODELS, resolve_llm_model


async def pick_llm_for_user(db: AsyncSession, user: User | None) -> tuple[str, str] | None:
    """Prefer the user's default provider when a valid key exists, else first valid key."""
    if user:
        row = (
            await db.execute(
                select(ApiKey).where(ApiKey.provider == user.default_llm_provider)
            )
        ).scalar_one_or_none()
        if row and row.is_valid:
            return user.default_llm_provider, resolve_llm_model(
                user.default_llm_provider,
                user.default_llm_model,
            )
    for prov in DEFAULT_LLM_MODELS:
        row = (await db.execute(select(ApiKey).where(ApiKey.provider == prov))).scalar_one_or_none()
        if row and row.is_valid:
            return prov, DEFAULT_LLM_MODELS[prov]
    return None
