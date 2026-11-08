import uuid
import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.services.auth import decode_access_token
from app.models.user import User, UserRole
from app.services.fx_service import SUPPORTED_CURRENCIES

bearer = HTTPBearer()



def normalize_currency(code: str | None, fallback: str) -> str:
    """The upper-cased code (or fallback when blank). ValueError if it is not supported."""
    resolved = (code or "").strip().upper() or (fallback or "USD").strip().upper()
    if resolved not in SUPPORTED_CURRENCIES:
        raise ValueError(f"Unsupported currency: {resolved}")
    return resolved

async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    result = await db.execute(select(User).where(User.id == uuid.UUID(payload["sub"])))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin required")
    return user


async def resolve_display_currency(
    currency: str | None = Query(None, max_length=8),
    user: User = Depends(get_current_user),
) -> str:
    """The currency to show money in: ?currency= when given, else the user's preference."""
    try:
        return normalize_currency(currency, user.preferred_currency or "USD")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
