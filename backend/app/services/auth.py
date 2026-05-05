from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from app.config import settings

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_access_token(user_id: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": user_id, "role": role, "exp": exp}, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])


def create_invite_token(email: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=48)
    return jwt.encode({"sub": email, "type": "invite", "exp": exp}, settings.jwt_secret, algorithm=ALGORITHM)


def verify_invite_token(token: str) -> str:
    """Returns the invited email address, or raises ValueError."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        if payload.get("type") != "invite":
            raise ValueError("Invalid token type")
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise ValueError("Invite token has expired")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid invite token")
