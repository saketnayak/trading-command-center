"""Resolving clients from the encrypted api_keys table (needs the DB)."""

import json
import uuid

import pytest

from app.database import AsyncSessionLocal
from app.models.api_key import ApiKey
from app.models.user import User, UserRole
from app.services.alpaca_paper_client import AlpacaConfigError, alpaca_client_from_db
from app.services.encryption import encrypt_key
from app.services.jev_client import resolve_jev_client
from jev_loop.assets import resolve_symbol


async def _seed(*keys: tuple[str, str, bool]) -> None:
    async with AsyncSessionLocal() as db:
        user = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex}@x.com", name="A", role=UserRole.admin, hashed_password="x")
        db.add(user)
        await db.flush()
        for provider, key, valid in keys:
            db.add(ApiKey(provider=provider, encrypted_key=encrypt_key(key), is_valid=valid, created_by=user.id))
        await db.commit()


async def _resolve(**kw):
    async with AsyncSessionLocal() as db:
        return await resolve_jev_client(db, **kw)


async def test_no_keys_means_the_labelled_mock():
    client = await _resolve()
    assert client.is_mock


async def test_gateway_key_is_used_when_present():
    await _seed(("ai_gateway", "vck_1", True))
    client = await _resolve()
    assert client.name == "Vercel AI Gateway"
    await client.aclose()


async def test_direct_typesafe_key_wins_over_the_gateway():
    await _seed(("ai_gateway", "vck_1", True), ("typesafe", "ts_1", True))
    client = await _resolve()
    assert client.name == "TypeSafe direct"
    await client.aclose()


async def test_invalid_keys_are_ignored():
    await _seed(("ai_gateway", "vck_1", False))
    assert (await _resolve()).is_mock


async def test_force_mock_ignores_real_keys():
    await _seed(("ai_gateway", "vck_1", True))
    assert (await _resolve(force_mock=True)).is_mock


async def test_alpaca_client_needs_a_valid_paper_key():
    async with AsyncSessionLocal() as db:
        with pytest.raises(AlpacaConfigError):
            await alpaca_client_from_db(db, resolve_symbol("BTC/USD"), order_prefix="p-")


async def test_alpaca_client_is_built_from_the_stored_key():
    await _seed(("alpaca_paper", json.dumps({"key_id": "PKX", "secret": "s"}), True))
    async with AsyncSessionLocal() as db:
        client = await alpaca_client_from_db(db, resolve_symbol("BTC/USD"), order_prefix="p-")
    assert client.key_id == "PKX"
    await client.aclose()
