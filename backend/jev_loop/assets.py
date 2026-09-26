"""Symbol resolver: any crypto pair or US equity ticker -> AssetSpec."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

CRYPTO_DATA_BASE = "https://data.alpaca.markets/v1beta3/crypto/us"
EQUITY_DATA_BASE = "https://data.alpaca.markets/v2/stocks"

_CRYPTO_PATTERN = re.compile(r"^[A-Z0-9]{2,10}/(USD|USDT|USDC)$")
_APP_CRYPTO_PATTERN = re.compile(r"^([A-Z0-9]{2,10})-(USD|USDT|USDC)$")  # yfinance spelling
_EQUITY_PATTERN = re.compile(r"^[A-Z]{1,5}$")


class UnknownSymbolError(Exception):
    pass


@dataclass(frozen=True)
class AssetSpec:
    symbol: str
    asset_class: str  # "crypto" | "us_equity"
    tick_size: float
    min_notional_usd: float
    qty_precision: int
    shorting_allowed: bool
    is_24_7: bool
    has_depth: bool
    orderbook_url: str | None
    latest_trade_url: str
    recent_trades_url: str
    latest_quote_url: str
    bars_url: str


def resolve_symbol(raw: str) -> AssetSpec:
    sym = raw.strip().upper()
    app_crypto = _APP_CRYPTO_PATTERN.match(sym)
    if app_crypto:
        sym = f"{app_crypto.group(1)}/{app_crypto.group(2)}"

    if _CRYPTO_PATTERN.match(sym):
        return AssetSpec(
            symbol=sym,
            asset_class="crypto",
            tick_size=0.01,
            min_notional_usd=10.0,
            qty_precision=8,
            shorting_allowed=False,
            is_24_7=True,
            has_depth=True,
            orderbook_url=f"{CRYPTO_DATA_BASE}/latest/orderbooks",
            latest_trade_url=f"{CRYPTO_DATA_BASE}/latest/trades",
            recent_trades_url=f"{CRYPTO_DATA_BASE}/trades",
            latest_quote_url=f"{CRYPTO_DATA_BASE}/latest/quotes",
            bars_url=f"{CRYPTO_DATA_BASE}/bars",
        )

    if _EQUITY_PATTERN.match(sym):
        return AssetSpec(
            symbol=sym,
            asset_class="us_equity",
            tick_size=0.01,
            min_notional_usd=1.0,
            qty_precision=4,
            shorting_allowed=False,
            is_24_7=False,
            has_depth=False,  # the free IEX feed has no L2 book
            orderbook_url=None,
            latest_trade_url=f"{EQUITY_DATA_BASE}/trades/latest",
            recent_trades_url=f"{EQUITY_DATA_BASE}/trades",
            latest_quote_url=f"{EQUITY_DATA_BASE}/quotes/latest",
            bars_url=f"{EQUITY_DATA_BASE}/bars",
        )

    raise UnknownSymbolError(
        f"'{raw}' does not look like a crypto pair (BTC/USD, ETH/USD, ...) or a "
        "US equity ticker (AAPL, SPY, TSLA, NVDA, ...)."
    )


def size_order(notional_usd: float, price: float, spec: AssetSpec) -> float:
    """Dollar target -> quantity at the asset's precision, never below the
    venue's minimum notional."""
    if price <= 0:
        raise ValueError("price must be positive")
    target = max(notional_usd, spec.min_notional_usd)
    step = 10 ** (-spec.qty_precision)
    qty = math.ceil(target / price / step - 1e-9) * step
    return round(qty, spec.qty_precision)


def floor_qty(qty: float, spec: AssetSpec) -> float:
    """Round a quantity down to the asset's precision (never sell more than held)."""
    step = 10 ** (-spec.qty_precision)
    return round(math.floor(qty / step + 1e-9) * step, spec.qty_precision)
