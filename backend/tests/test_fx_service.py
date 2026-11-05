"""Unit test: the FX refresh calls Frankfurter's current endpoint and follows redirects."""
import httpx
import pytest

from app.services import fx_service

pytestmark = pytest.mark.unit


async def test_refresh_uses_current_endpoint_and_follows_redirects(monkeypatch):
    seen = {}

    class FakeClient:
        def __init__(self, **kwargs):
            seen["kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, params=None):
            seen["url"] = url
            return httpx.Response(200, json={"rates": {"EUR": 0.9, "GBP": 0.75}}, request=httpx.Request("GET", url))

    monkeypatch.setattr(fx_service.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(fx_service, "_rates_expiry", 0.0)
    fx_service._rates_cache.clear()
    assert await fx_service.get_rate("EUR") == 0.9
    assert seen["url"] == "https://api.frankfurter.dev/v1/latest" and seen["kwargs"]["follow_redirects"] is True
    fx_service._rates_cache.clear()
    monkeypatch.setattr(fx_service, "_rates_expiry", 0.0)
