import uuid
from app.services.auth import hash_password, verify_password, create_access_token, decode_access_token


def test_password_round_trip():
    pw = "hunter2"
    assert verify_password(pw, hash_password(pw))


def test_wrong_password_fails():
    assert not verify_password("wrong", hash_password("right"))


def test_jwt_round_trip():
    uid = str(uuid.uuid4())
    token = create_access_token(uid, "admin")
    payload = decode_access_token(token)
    assert payload["sub"] == uid
    assert payload["role"] == "admin"
