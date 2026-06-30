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
    png_bytes = b"\x89PNG\r\n\x1a\n"

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
    png_a = b"\x89PNG-a"
    png_b = b"\x89PNG-b"

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
