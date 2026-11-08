"""
FX rate service — converts between the supported currencies for display.

Rates come from three layers, freshest first:
  1. live: Yahoo Finance FX pairs (USD→ccy), cached for settings.fx_live_ttl_s;
  2. ecb: Frankfurter (https://api.frankfurter.dev), ECB daily reference rates, cached 24 h;
  3. stale: the last snapshot that had any rates.
An unknown rate is None — callers leave the value out and say so; it is never taken as 1:1.
"""
import asyncio
import logging
import math
import time
import weakref
from dataclasses import dataclass, replace
from datetime import date, datetime, time as dtime, timezone
from typing import Iterable, Literal, Optional

import httpx

from app.config import settings
from app.services import yfinance_service

logger = logging.getLogger(__name__)

SUPPORTED_CURRENCIES = frozenset({
    "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK",
    "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
})
_TARGETS = sorted(SUPPORTED_CURRENCIES - {"USD"})  # USD is the base
_ECB_TTL = 86_400  # 24 hours

FxSource = Literal["live", "ecb", "stale"]


@dataclass(frozen=True)
class FxSnapshot:
    rates: dict[str, float]  # USD -> ccy; always contains "USD": 1.0
    source: Optional[FxSource]  # None only when no layer has ever succeeded
    as_of: Optional[datetime]  # UTC; when upstream observed the rates

    def convert(self, frm: str, to: str) -> Optional[float]:
        """Multiplier from one currency to another, through USD; None when either rate is unknown."""
        frm, to = frm.upper(), to.upper()
        if frm == to:
            return 1.0
        usd_to_frm = self.rates.get(frm)
        usd_to_to = self.rates.get(to)
        if not usd_to_frm or not usd_to_to:
            return None
        return usd_to_to / usd_to_frm

    def meta(self, display: str, sources: Iterable[str]) -> dict:
        """What a response tells the UI about its rates: source, age, and each pair it used."""
        used = {}
        for src in sorted({s.upper() for s in sources if s}):
            if src == display.upper():
                continue
            rate = self.convert(src, display)
            if rate is not None:
                used[src] = rate
        return {"source": self.source, "as_of": self.as_of.isoformat() if self.as_of else None, "rates_used": used}


_EMPTY = FxSnapshot(rates={"USD": 1.0}, source=None, as_of=None)

_current: Optional[FxSnapshot] = None
_current_expiry: float = 0.0
_ecb: Optional[FxSnapshot] = None
_ecb_expiry: float = 0.0
_last_good: Optional[FxSnapshot] = None
_locks: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    if loop not in _locks:
        _locks[loop] = asyncio.Lock()
    return _locks[loop]


def _reset_layers() -> None:
    global _current, _current_expiry, _ecb, _ecb_expiry, _last_good
    _current, _current_expiry, _ecb, _ecb_expiry, _last_good = None, 0.0, None, 0.0, None


def _expire_layers() -> None:
    """Expire the cached layers but keep the last known snapshot (used by tests)."""
    global _current_expiry, _ecb_expiry
    _current_expiry = _ecb_expiry = 0.0


async def _fetch_ecb() -> tuple[dict[str, float], date]:
    # api.frankfurter.app now 301-redirects here; follow any later move too.
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        r = await client.get(
            "https://api.frankfurter.dev/v1/latest",
            params={"from": "USD", "to": ",".join(_TARGETS)},
        )
        r.raise_for_status()
        data = r.json()
    rates = {code.upper(): float(rate) for code, rate in (data.get("rates") or {}).items()}
    return rates, date.fromisoformat(data["date"])


def _usable(rate) -> bool:
    try:
        return math.isfinite(rate) and rate > 0
    except TypeError:
        return False


async def _ecb_layer() -> Optional[FxSnapshot]:
    global _ecb, _ecb_expiry
    if _ecb is not None and time.time() < _ecb_expiry:
        return _ecb
    try:
        rates, day = await _fetch_ecb()
        rates = {c: r for c, r in rates.items() if c in SUPPORTED_CURRENCIES and _usable(r)}
        if not rates:
            raise ValueError("no rates in response")
        _ecb = FxSnapshot(rates={**rates, "USD": 1.0}, source="ecb",
                          as_of=datetime.combine(day, dtime.min, tzinfo=timezone.utc))
        _ecb_expiry = time.time() + _ECB_TTL
    except Exception as e:
        logger.warning("ECB FX refresh failed (%s)", e)
        return None  # an expired ECB snapshot is served by the stale layer, labelled as such
    return _ecb


async def _real_snapshot() -> FxSnapshot:
    """The current rates. Each request should call this once and use the result for every value."""
    global _current, _current_expiry, _last_good
    if _current is not None and time.time() < _current_expiry:
        return _current
    async with _lock():
        if _current is not None and time.time() < _current_expiry:
            return _current
        ecb = await _ecb_layer()
        try:
            quotes = await yfinance_service.fetch_fx_quotes(_TARGETS)
        except Exception as e:
            logger.warning("Live FX refresh failed (%s)", e)
            quotes = {}
        live = {c.upper(): (r, t) for c, (r, t) in quotes.items() if c.upper() in SUPPORTED_CURRENCIES and _usable(r)}
        if live:
            rates = {**(ecb.rates if ecb else {}), **{c: r for c, (r, _) in live.items()}, "USD": 1.0}
            snap = FxSnapshot(rates=rates, source="live", as_of=min(t for _, t in live.values()))
        elif ecb is not None:
            snap = ecb
        elif _last_good is not None:
            snap = replace(_last_good, source="stale")
        else:
            snap = _EMPTY
        if snap.source in ("live", "ecb"):
            _last_good = snap
        # A failed live fetch waits a full TTL too, so an outage does not cost every request.
        _current, _current_expiry = snap, time.time() + settings.fx_live_ttl_s
        return snap


snapshot = _real_snapshot


async def convert_rate(frm: str, to: str) -> Optional[float]:
    """Multiplier from one currency to another, or None when a rate is unknown."""
    return (await snapshot()).convert(frm, to)
