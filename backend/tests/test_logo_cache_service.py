from datetime import datetime, timedelta, timezone
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

pytestmark = pytest.mark.unit

from app.services import logo_cache_service


@pytest.fixture
def logo_cache_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(logo_cache_service.settings, "logo_cache_dir", str(tmp_path))
    return tmp_path


def test_get_cached_logo_miss(logo_cache_dir):
    assert logo_cache_service.get_cached_logo("AAPL", "https://logo.example/aapl.png") is None


@pytest.mark.asyncio
async def test_ensure_logo_cached_downloads_and_reuses(logo_cache_dir):
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"x" * 128

    async def fake_get(url: str):
        request = httpx.Request("GET", url)
        return httpx.Response(200, content=png_bytes, headers={"content-type": "image/png"}, request=request)

    with patch.object(httpx.AsyncClient, "get", new=AsyncMock(side_effect=fake_get)):
        first = await logo_cache_service.ensure_logo_cached("AAPL", "https://logo.example/aapl.png")
        second = await logo_cache_service.ensure_logo_cached("AAPL", "https://logo.example/aapl.png")

    assert first is not None
    assert second is not None
    assert first[0] == second[0]
    assert first[0].is_file()
    assert first[1] == "image/png"


@pytest.mark.asyncio
async def test_ensure_logo_cached_refreshes_when_source_url_changes(logo_cache_dir):
    png_a = b"\x89PNG\r\n\x1a\n" + b"a" * 128
    png_b = b"\x89PNG\r\n\x1a\n" + b"b" * 128

    async def fake_get(url: str):
        request = httpx.Request("GET", url)
        body = png_b if "b.png" in url else png_a
        return httpx.Response(200, content=body, headers={"content-type": "image/png"}, request=request)

    with patch.object(httpx.AsyncClient, "get", new=AsyncMock(side_effect=fake_get)):
        await logo_cache_service.ensure_logo_cached("MSFT", "https://logo.example/a.png")
        refreshed = await logo_cache_service.ensure_logo_cached("MSFT", "https://logo.example/b.png")

    assert refreshed is not None
    assert refreshed[0].read_bytes() == png_b


def test_get_cached_logo_expired(logo_cache_dir, monkeypatch):
    ticker = "NVDA"
    source_url = "https://logo.example/nvda.png"
    image_path = logo_cache_dir / "NVDA.png"
    image_path.write_bytes(b"png")
    meta_path = logo_cache_dir / "NVDA.meta.json"
    stale = datetime.now(timezone.utc) - timedelta(days=31)
    meta_path.write_text(
        json.dumps(
            {
                "source_url": source_url,
                "cached_at": stale.isoformat(),
                "content_type": "image/png",
                "extension": ".png",
            }
        ),
        encoding="utf-8",
    )

    assert logo_cache_service.get_cached_logo(ticker, source_url) is None


@pytest.mark.unit
def test_domain_from_website():
    assert logo_cache_service._domain_from_website("https://www.rheinmetall.com/en") == "rheinmetall.com"
    assert logo_cache_service._domain_from_website("rheinmetall.com") == "rheinmetall.com"
    assert logo_cache_service._domain_from_website("") is None


@pytest.mark.unit
def test_logo_source_candidates_prefers_finnhub_then_favicon():
    candidates = logo_cache_service._logo_source_candidates(
        "https://static.finnhub.io/logo/aapl.png",
        "https://www.apple.com",
    )
    assert candidates[0] == "https://static.finnhub.io/logo/aapl.png"
    assert "duckduckgo.com/ip3/apple.com.ico" in candidates[1]
    assert "google.com/s2/favicons?domain=apple.com" in candidates[2]


@pytest.mark.unit
def test_logo_source_candidates_website_only():
    candidates = logo_cache_service._logo_source_candidates(
        None,
        "https://www.rheinmetall.com",
    )
    assert len(candidates) == 3
    assert "rheinmetall.com" in candidates[0]


@pytest.mark.asyncio
async def test_ensure_logo_for_ticker_falls_back_to_favicon(logo_cache_dir):
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"x" * 128
    calls: list[str] = []

    async def fake_get(url: str):
        calls.append(url)
        request = httpx.Request("GET", url)
        if "finnhub" in url:
            return httpx.Response(404, request=request)
        return httpx.Response(
            200,
            content=png_bytes,
            headers={"content-type": "image/png"},
            request=request,
        )

    with patch.object(httpx.AsyncClient, "get", new=AsyncMock(side_effect=fake_get)):
        result = await logo_cache_service.ensure_logo_for_ticker(
            "RHM.DE",
            logo_url="https://static.finnhub.io/logo/rhm.png",
            website="https://www.rheinmetall.com",
        )

    assert result is not None
    assert calls[0].startswith("https://static.finnhub.io/")
    assert any("duckduckgo.com" in url for url in calls)

