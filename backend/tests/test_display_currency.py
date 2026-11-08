"""The display currency: ?currency= with a fallback to the user's preference, and GET /fx/rates."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.dependencies import normalize_currency
from main import app
from tests.test_portfolio_integration import _auth, _register_and_login


@pytest.mark.unit
def test_normalize_currency():
    assert normalize_currency("aud", "USD") == "AUD"
    assert normalize_currency(None, "eur") == "EUR"
    assert normalize_currency("", "usd") == "USD"
    with pytest.raises(ValueError):
        normalize_currency("XYZ", "USD")


async def test_fx_rates_endpoint(fixed_fx):
    fixed_fx({"USD": 1.0, "AUD": 1.5, "EUR": 0.9})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "fxrates1@example.com")
        body = (await client.get("/fx/rates?base=aud", headers=_auth(token))).json()
    assert body["base"] == "AUD" and body["rates"]["USD"] == pytest.approx(1 / 1.5)
    assert body["rates"]["EUR"] == pytest.approx(0.6) and body["rates"]["AUD"] == 1.0
    assert body["source"] == "live" and body["as_of"].startswith("2026-01-02")
    assert "NZD" in body["supported"] and "NZD" not in body["rates"]
    assert body["supported"] == sorted(body["supported"])


async def test_fx_rates_rejects_unsupported_base():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "fxrates2@example.com")
        assert (await client.get("/fx/rates?base=XYZ", headers=_auth(token))).status_code == 422
