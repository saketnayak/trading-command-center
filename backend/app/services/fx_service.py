"""
FX rate service — converts USD prices to a user's preferred display currency.
Source: Frankfurter (https://api.frankfurter.app), ECB-backed, free, no API key.
Rates are cached process-wide for 24 hours; degrades to 1.0 (USD pass-through)
if the upstream call fails.
"""
import logging
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

SUPPORTED_CURRENCIES = {"USD", "EUR", "GBP", "AUD", "JPY", "CAD", "CHF", "CNY", "INR", "SGD"}
_TARGETS = ",".join(SUPPORTED_CURRENCIES - {"USD"})  # USD is the base

_rates_cache: dict[str, float] = {}
_rates_expiry: float = 0.0
_FX_TTL = 86_400  # 24 hours


async def _refresh_rates() -> None:
    global _rates_expiry
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                "https://api.frankfurter.app/latest",
                params={"from": "USD", "to": _TARGETS},
            )
            r.raise_for_status()
            data = r.json()
        rates = data.get("rates", {})
        _rates_cache.clear()
        for code, rate in rates.items():
            _rates_cache[code.upper()] = float(rate)
        _rates_cache["USD"] = 1.0
        _rates_expiry = time.time() + _FX_TTL
        logger.info("FX rates refreshed: %s", list(_rates_cache.keys()))
    except Exception as e:
        logger.warning("FX rate refresh failed (%s) — using cached/default rates", e)
        if not _rates_cache:
            _rates_cache["USD"] = 1.0


async def get_rate(currency: str) -> float:
    """Return the USD → currency multiplier. Returns 1.0 for USD or on failure."""
    code = currency.upper()
    if code == "USD":
        return 1.0
    if time.time() > _rates_expiry:
        await _refresh_rates()
    return _rates_cache.get(code, 1.0)


def apply(value: Optional[float], rate: float) -> Optional[float]:
    """Multiply a nullable USD value by an FX rate."""
    if value is None:
        return None
    return value * rate
