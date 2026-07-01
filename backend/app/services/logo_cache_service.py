"""Disk-backed cache for company logo image bytes."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

LOGO_CACHE_TTL = timedelta(days=30)
_TICKER_FILENAME_RE = re.compile(r"^[A-Z0-9.-]+$")

_CONTENT_TYPE_EXT: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/gif": ".gif",
}


def _normalize_ticker(ticker: str) -> str:
    return ticker.strip().upper()


def _cache_dir() -> Path:
    path = Path(settings.logo_cache_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_filename(ticker: str) -> str:
    normalized = _normalize_ticker(ticker)
    if not _TICKER_FILENAME_RE.match(normalized):
        raise ValueError(f"Invalid ticker for logo cache: {ticker!r}")
    return normalized


def _meta_path(ticker: str) -> Path:
    return _cache_dir() / f"{_safe_filename(ticker)}.meta.json"


def _image_path(ticker: str, extension: str) -> Path:
    return _cache_dir() / f"{_safe_filename(ticker)}{extension}"


def _extension_from_url(url: str) -> str:
    path = urlparse(url).path.lower()
    for ext in (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"):
        if path.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext
    return ".png"


def _extension_from_content_type(content_type: str | None, fallback_url: str) -> str:
    if content_type:
        base = content_type.split(";", 1)[0].strip().lower()
        if base in _CONTENT_TYPE_EXT:
            return _CONTENT_TYPE_EXT[base]
    return _extension_from_url(fallback_url)


_MIN_LOGO_BYTES = 64


def _domain_from_website(website: str | None) -> str | None:
    if not website or not website.strip():
        return None
    raw = website.strip()
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = (parsed.netloc or parsed.path.split("/")[0]).lower()
    host = host.removeprefix("www.")
    if not host or "." not in host:
        return None
    return host


def _logo_source_candidates(logo_url: str | None, website: str | None) -> list[str]:
    """Ordered logo download URLs: Finnhub direct URL, then website favicon services."""
    candidates: list[str] = []
    if logo_url and logo_url.strip():
        candidates.append(logo_url.strip())

    domain = _domain_from_website(website)
    if domain:
        favicon_urls = [
            f"https://icons.duckduckgo.com/ip3/{domain}.ico",
            f"https://www.google.com/s2/favicons?domain={domain}&sz=128",
        ]
        if website and website.strip():
            base = website.strip().rstrip("/")
            if "://" not in base:
                base = f"https://{base}"
            favicon_urls.append(f"{base}/favicon.ico")
        for url in favicon_urls:
            if url not in candidates:
                candidates.append(url)
    return candidates


def _is_valid_logo_content(content: bytes, content_type: str | None) -> bool:
    if len(content) < _MIN_LOGO_BYTES:
        return False
    if content_type:
        base = content_type.split(";", 1)[0].strip().lower()
        if base.startswith("image/"):
            return True
    return content.startswith((b"\x89PNG", b"\xff\xd8\xff", b"GIF8"))


def _load_meta(ticker: str) -> dict[str, Any] | None:
    path = _meta_path(ticker)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("logo cache meta unreadable for %s: %s", ticker, exc)
        return None


def _write_meta(ticker: str, payload: dict[str, Any]) -> None:
    _meta_path(ticker).write_text(json.dumps(payload), encoding="utf-8")


def _parse_cached_at(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _is_cache_valid(meta: dict[str, Any], source_url: str, now: datetime) -> bool:
    if meta.get("source_url") != source_url:
        return False
    cached_at_raw = meta.get("cached_at")
    if not cached_at_raw:
        return False
    cached_at = _parse_cached_at(str(cached_at_raw))
    return now - cached_at < LOGO_CACHE_TTL


def _invalidate(ticker: str) -> None:
    meta = _load_meta(ticker)
    if meta:
        extension = str(meta.get("extension") or ".png")
        image = _image_path(ticker, extension)
        if image.is_file():
            image.unlink(missing_ok=True)
    _meta_path(ticker).unlink(missing_ok=True)


def get_cached_logo(ticker: str, source_url: str | None) -> tuple[Path, str] | None:
    """Return cached logo file path and content type when valid."""
    if not source_url:
        return None
    meta = _load_meta(ticker)
    if meta is None:
        return None
    now = datetime.now(timezone.utc)
    if not _is_cache_valid(meta, source_url, now):
        return None
    extension = str(meta.get("extension") or ".png")
    image = _image_path(ticker, extension)
    if not image.is_file():
        return None
    content_type = str(meta.get("content_type") or "image/png")
    return image, content_type


async def ensure_logo_cached(ticker: str, source_url: str | None) -> tuple[Path, str] | None:
    """Download and persist a logo when missing or stale. Returns path + content type."""
    if not source_url:
        return None

    cached = get_cached_logo(ticker, source_url)
    if cached is not None:
        return cached

    _invalidate(ticker)

    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            response = await client.get(source_url)
            response.raise_for_status()
            content = response.content
            if not content:
                return None
            content_type = response.headers.get("content-type")
            if not _is_valid_logo_content(content, content_type):
                logger.info("logo download rejected for %s: invalid or too small payload", ticker)
                return None
    except Exception as exc:
        logger.info("logo download failed for %s: %s", ticker, exc)
        return None

    extension = _extension_from_content_type(content_type, source_url)
    normalized_type = (content_type or "image/png").split(";", 1)[0].strip().lower()
    image_path = _image_path(ticker, extension)
    image_path.write_bytes(content)
    now = datetime.now(timezone.utc)
    _write_meta(
        ticker,
        {
            "source_url": source_url,
            "cached_at": now.isoformat(),
            "content_type": normalized_type,
            "extension": extension,
        },
    )
    return image_path, normalized_type


async def ensure_logo_for_ticker(
    ticker: str,
    *,
    logo_url: str | None = None,
    website: str | None = None,
) -> tuple[Path, str] | None:
    """Download and cache a logo, trying Finnhub URL then website favicon fallbacks."""
    for source_url in _logo_source_candidates(logo_url, website):
        cached = await ensure_logo_cached(ticker, source_url)
        if cached is not None:
            return cached
    return None
