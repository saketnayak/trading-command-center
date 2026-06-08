import pytest

from app.services.encryption import encrypt_key, decrypt_key

pytestmark = pytest.mark.unit


def test_round_trip():
    original = "sk-proj-abc123"
    assert decrypt_key(encrypt_key(original)) == original


def test_different_ciphertext_each_time():
    key = "sk-proj-abc123"
    assert encrypt_key(key) != encrypt_key(key)  # Fernet uses random IV
