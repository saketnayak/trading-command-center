"""Unit tests: FX snapshot layers (Yahoo live → Frankfurter/ECB daily → last known), never 1:1."""
from datetime import date, datetime, timezone

import httpx
import pytest

from app.services import fx_service

pytestmark = pytest.mark.unit

AS_OF = datetime(2026, 1, 2, 15, 0, tzinfo=timezone.utc)


class _Calls:
    count = 0


@pytest.fixture(autouse=True)
def _fresh_layers(monkeypatch):
    """Each test starts with no cached layer and with the real snapshot (not the conftest stub)."""
    monkeypatch.setattr(fx_service, "snapshot", fx_service._real_snapshot)
    fx_service._reset_layers()
    yield
    fx_service._reset_layers()


@pytest.fixture
def fake_live(monkeypatch):
    def set_live(rates_or_exc):
        calls = _Calls()

        async def fetch(codes):
            calls.count += 1
            if isinstance(rates_or_exc, Exception):
                raise rates_or_exc
            return {c: (r, AS_OF) for c, r in rates_or_exc.items()}

        monkeypatch.setattr(fx_service.yfinance_service, "fetch_fx_quotes", fetch)
        return calls

    return set_live


@pytest.fixture
def fake_ecb(monkeypatch):
    def set_ecb(rates_or_exc, day="2026-01-02"):
        async def fetch():
            if isinstance(rates_or_exc, Exception):
                raise rates_or_exc
            return dict(rates_or_exc), date.fromisoformat(day)

        monkeypatch.setattr(fx_service, "_fetch_ecb", fetch)

    return set_ecb


@pytest.fixture
def expire_layers():
    return fx_service._expire_layers


async def test_live_rates_win_and_ecb_fills_missing_pairs(fake_live, fake_ecb):
    fake_live({"AUD": 1.52, "EUR": 0.93})
    fake_ecb({"AUD": 1.50, "EUR": 0.92, "GBP": 0.79})
    snap = await fx_service.snapshot()
    assert snap.source == "live" and snap.as_of == AS_OF
    assert snap.rates["AUD"] == 1.52 and snap.rates["GBP"] == 0.79 and snap.rates["USD"] == 1.0


async def test_live_rejects_non_positive_and_nan_rates(fake_live, fake_ecb):
    fake_live({"AUD": 0.0, "EUR": float("nan"), "GBP": -1.0, "JPY": 150.0})
    fake_ecb({"AUD": 1.5, "EUR": 0.9, "GBP": 0.8})
    snap = await fx_service.snapshot()
    assert (snap.rates["AUD"], snap.rates["EUR"], snap.rates["GBP"], snap.rates["JPY"]) == (1.5, 0.9, 0.8, 150.0)


async def test_falls_back_to_ecb_when_live_fails(fake_live, fake_ecb):
    fake_live(RuntimeError("yahoo down"))
    fake_ecb({"AUD": 1.5})
    snap = await fx_service.snapshot()
    assert snap.source == "ecb" and snap.as_of.date().isoformat() == "2026-01-02"
    assert snap.rates == {"USD": 1.0, "AUD": 1.5}


async def test_falls_back_to_last_known_marked_stale(fake_live, fake_ecb, expire_layers):
    fake_live({"AUD": 1.52})
    fake_ecb({"AUD": 1.5})
    await fx_service.snapshot()
    expire_layers()
    fake_live(RuntimeError("down"))
    fake_ecb(RuntimeError("down"))
    snap = await fx_service.snapshot()
    assert snap.source == "stale" and snap.rates["AUD"] == 1.52


async def test_nothing_ever_succeeded_gives_unknown_not_one(fake_live, fake_ecb):
    fake_live(RuntimeError("down"))
    fake_ecb(RuntimeError("down"))
    snap = await fx_service.snapshot()
    assert snap.source is None and snap.as_of is None
    assert snap.convert("AUD", "USD") is None and snap.convert("USD", "USD") == 1.0


async def test_failed_live_fetch_is_not_retried_every_request(fake_live, fake_ecb):
    calls = fake_live(RuntimeError("down"))
    fake_ecb({"AUD": 1.5})
    await fx_service.snapshot()
    await fx_service.snapshot()
    assert calls.count == 1


async def test_convert_rate_uses_the_snapshot(fake_live, fake_ecb):
    fake_live({"AUD": 1.5})
    fake_ecb(RuntimeError("down"))
    assert await fx_service.convert_rate("AUD", "USD") == pytest.approx(1 / 1.5)
    assert await fx_service.convert_rate("EUR", "USD") is None


def test_convert_and_meta():
    snap = fx_service.FxSnapshot(rates={"USD": 1.0, "AUD": 1.5, "EUR": 0.9}, source="live", as_of=AS_OF)
    assert snap.convert("AUD", "EUR") == pytest.approx(0.6)
    assert snap.convert("aud", "aud") == 1.0
    assert snap.convert("HKD", "USD") is None
    assert snap.meta("AUD", ["USD", "AUD", "HKD"]) == {
        "source": "live", "as_of": AS_OF.isoformat(), "rates_used": {"USD": 1.5}}


def test_supported_currencies_is_the_frankfurter_set():
    assert len(fx_service.SUPPORTED_CURRENCIES) == 31
    assert {"NZD", "HKD", "KRW", "USD"} <= fx_service.SUPPORTED_CURRENCIES


async def test_ecb_fetch_uses_current_endpoint_and_follows_redirects(monkeypatch, fake_live):
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
            body = {"date": "2026-01-02", "rates": {"EUR": 0.9, "GBP": 0.75}}
            return httpx.Response(200, json=body, request=httpx.Request("GET", url))

    monkeypatch.setattr(fx_service.httpx, "AsyncClient", FakeClient)
    fake_live(RuntimeError("down"))
    snap = await fx_service.snapshot()
    assert snap.source == "ecb" and snap.rates["EUR"] == 0.9
    assert seen["url"] == "https://api.frankfurter.dev/v1/latest" and seen["kwargs"]["follow_redirects"] is True
