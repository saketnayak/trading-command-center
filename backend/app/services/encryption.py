import base64
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken
from app.config import settings


def _fernet() -> Fernet:
    raw = bytes.fromhex(settings.encryption_key)
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt_key(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_key(ciphertext: str) -> Optional[str]:
    """Returns None if the ciphertext was encrypted with a different key."""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        return None
