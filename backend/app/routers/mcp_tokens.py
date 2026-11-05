"""Personal access tokens for the MCP server (Settings → MCP access).

The token is returned once, on creation; only its SHA-256 is stored.
Paths are /mcp-tokens (not under /mcp, which is the MCP endpoint itself).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.mcp_server import MCP_AVAILABLE, hash_token, new_token
from app.models.mcp_token import McpToken
from app.models.user import User

router = APIRouter()

MAX_TOKENS_PER_USER = 20


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[Literal["read", "research"]] = Field(default_factory=lambda: ["read"])
    expires_in_days: int | None = Field(default=90, ge=1, le=3650)  # None: never expires


def _token_dict(t: McpToken) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "id": str(t.id),
        "name": t.name,
        "prefix": t.prefix,
        "scopes": t.scopes,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
        "expires_at": t.expires_at.isoformat() if t.expires_at else None,
        "active": t.revoked_at is None and (t.expires_at is None or t.expires_at > now),
    }


@router.get("/mcp-tokens")
async def list_tokens(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(McpToken).where(McpToken.user_id == user.id, McpToken.revoked_at.is_(None)).order_by(McpToken.created_at.desc())
    )).scalars().all()
    return {"available": MCP_AVAILABLE, "tokens": [_token_dict(t) for t in rows]}


@router.post("/mcp-tokens", status_code=status.HTTP_201_CREATED)
async def create_token(body: TokenCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    count = (await db.execute(select(func.count()).select_from(McpToken).where(
        McpToken.user_id == user.id, McpToken.revoked_at.is_(None)))).scalar_one()
    if count >= MAX_TOKENS_PER_USER:
        raise HTTPException(status_code=409, detail=f"At most {MAX_TOKENS_PER_USER} active tokens; revoke one first")
    token = new_token()
    scopes = ["read"] + (["research"] if "research" in body.scopes else [])
    row = McpToken(
        user_id=user.id, name=body.name.strip(), token_hash=hash_token(token), prefix=token[:10], scopes=scopes,
        expires_at=datetime.now(timezone.utc) + timedelta(days=body.expires_in_days) if body.expires_in_days else None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {**_token_dict(row), "token": token}


@router.delete("/mcp-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(token_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row = (await db.execute(select(McpToken).where(McpToken.id == token_id, McpToken.user_id == user.id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Token not found")
    row.revoked_at = datetime.now(timezone.utc)
    await db.commit()
