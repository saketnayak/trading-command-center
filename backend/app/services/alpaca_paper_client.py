"""Async Alpaca client for JEV Lab: market data plus PAPER execution only.

There is no live-trading path. The trading base URL is a constant, the
constructor takes no URL, and nothing reads one from the environment.
Every order carries the session's client_order_id prefix, so a session
only ever reconciles, cancels or flattens what it placed itself. All
requests share one rate limiter per key (see jev_rate_limiter.py).
"""

from __future__ import annotations

import json
import time
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import ApiKey
from app.services.encryption import decrypt_key
from app.services.jev_rate_limiter import limiter_for
from jev_loop.assets import AssetSpec
from jev_loop.state import parse_venue_ts

PAPER_TRADING_BASE_URL = "https://paper-api.alpaca.markets"


class AlpacaConfigError(Exception):
    pass


class AlpacaAPIError(Exception):
    def __init__(self, status_code: int, body: str):
        super().__init__(f"HTTP {status_code}: {body[:300]}")
        self.status_code = status_code
        self.body = body


class MarketClosedError(Exception):
    """We refused to send an equity order while the market is closed."""


def parse_alpaca_key(key: str) -> tuple[str, str] | None:
    """alpaca_paper keys are stored as JSON {"key_id", "secret"}."""
    try:
        data = json.loads(key)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    key_id, secret = data.get("key_id"), data.get("secret")
    if not isinstance(key_id, str) or not isinstance(secret, str) or not key_id or not secret:
        return None
    return key_id, secret


def new_order_prefix() -> str:
    return f"jevlab-{uuid.uuid4().hex[:8]}-"


class AlpacaPaperClient:
    def __init__(
        self, key_id: str, secret: str, *, spec: AssetSpec, order_prefix: str, limiter, id_namespace: str = ""
    ):
        self.key_id = key_id
        self.spec = spec
        self.symbol = spec.symbol
        self.order_prefix = order_prefix
        self._id_namespace = id_namespace
        self._headers = {"APCA-API-KEY-ID": key_id, "APCA-API-SECRET-KEY": secret}
        self._limiter = limiter
        self._http = httpx.AsyncClient(timeout=10)
        self._clock_cache: tuple[float, dict] | None = None
        self._order_seq = 0

    async def __aenter__(self) -> "AlpacaPaperClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    @property
    def orders_placed(self) -> int:
        return self._order_seq

    # -- HTTP ----------------------------------------------------------------

    async def _request(self, method: str, url: str, **kwargs):
        await self._limiter.acquire()
        resp = await self._http.request(method, url, headers=self._headers, **kwargs)
        if resp.status_code == 401:
            raise AlpacaAPIError(
                401,
                "unauthorized: the stored key is wrong or is not a PAPER key. Generate one at "
                "https://app.alpaca.markets/paper/dashboard/overview and save it in Settings.",
            )
        if resp.status_code >= 400:
            raise AlpacaAPIError(resp.status_code, resp.text)
        return resp.json() if resp.content else {}

    # -- account and orders --------------------------------------------------

    async def get_account(self) -> dict:
        return await self._request("GET", f"{PAPER_TRADING_BASE_URL}/v2/account")

    async def get_clock(self, cache_s: float = 5.0) -> dict:
        now = time.monotonic()
        if self._clock_cache and now - self._clock_cache[0] < cache_s:
            return self._clock_cache[1]
        data = await self._request("GET", f"{PAPER_TRADING_BASE_URL}/v2/clock")
        self._clock_cache = (now, data)
        return data

    async def is_market_open(self) -> bool:
        if self.spec.is_24_7:
            return True
        return bool((await self.get_clock()).get("is_open"))

    def _next_client_order_id(self) -> str:
        self._order_seq += 1
        return f"{self.order_prefix}{self._id_namespace}{self._order_seq}"

    def _qty_str(self, qty: float) -> str:
        return f"{qty:.{self.spec.qty_precision}f}"

    @staticmethod
    def _price_str(price: float) -> str:
        return f"{price:.2f}" if price >= 1 else f"{price:.6f}"

    def _time_in_force(self) -> str:
        # Fractional equity orders must be DAY; crypto trades 24/7 on GTC.
        return "gtc" if self.spec.asset_class == "crypto" else "day"

    async def _guard_market_hours(self) -> None:
        if not await self.is_market_open():
            raise MarketClosedError(f"{self.symbol} market is closed, refusing to submit an order")

    async def submit_limit_order(self, side: str, qty: float, limit_price: float) -> dict:
        await self._guard_market_hours()
        return await self._request(
            "POST",
            f"{PAPER_TRADING_BASE_URL}/v2/orders",
            json={
                "symbol": self.symbol,
                "qty": self._qty_str(qty),
                "side": side,
                "type": "limit",
                "time_in_force": self._time_in_force(),
                "limit_price": self._price_str(limit_price),
                "client_order_id": self._next_client_order_id(),
            },
        )

    async def submit_market_order(self, side: str, qty: float) -> dict:
        await self._guard_market_hours()
        return await self._request(
            "POST",
            f"{PAPER_TRADING_BASE_URL}/v2/orders",
            json={
                "symbol": self.symbol,
                "qty": self._qty_str(qty),
                "side": side,
                "type": "market",
                "time_in_force": self._time_in_force(),
                "client_order_id": self._next_client_order_id(),
            },
        )

    async def get_own_orders(self, after_iso: str) -> list[dict]:
        orders = await self._request(
            "GET",
            f"{PAPER_TRADING_BASE_URL}/v2/orders",
            params={"status": "all", "after": after_iso, "limit": 500, "direction": "desc"},
        )
        return [o for o in orders or [] if str(o.get("client_order_id", "")).startswith(self.order_prefix)]

    async def cancel_own_orders(self) -> int:
        """Cancel open orders carrying this session's prefix. Never calls the
        account-wide DELETE /v2/orders."""
        open_orders = await self._request(
            "GET", f"{PAPER_TRADING_BASE_URL}/v2/orders", params={"status": "open", "limit": 500}
        )
        cancelled = 0
        for o in open_orders or []:
            if not str(o.get("client_order_id", "")).startswith(self.order_prefix):
                continue
            try:
                await self._request("DELETE", f"{PAPER_TRADING_BASE_URL}/v2/orders/{o['id']}")
                cancelled += 1
            except AlpacaAPIError as exc:
                if exc.status_code != 422:  # 422: already filled or cancelled
                    raise
        return cancelled

    async def get_position_qty(self) -> float:
        sym = self.symbol.replace("/", "")
        try:
            pos = await self._request("GET", f"{PAPER_TRADING_BASE_URL}/v2/positions/{sym}")
        except AlpacaAPIError as exc:
            if exc.status_code == 404:
                return 0.0
            raise
        return float(pos.get("qty", 0.0))

    # -- market data ---------------------------------------------------------

    def _data_params(self, **extra) -> dict:
        params = {"symbols": self.symbol, **extra}
        if self.spec.asset_class != "crypto":
            params["feed"] = "iex"  # the free equities feed
        return params

    async def read_top_of_book(self) -> tuple[list[tuple[float, float]], list[tuple[float, float]], float | None]:
        """(bids, asks, venue_timestamp). L2 depth on crypto; best bid/ask
        only on equities. The venue timestamp drives the stale-data veto."""
        if self.spec.has_depth and self.spec.orderbook_url:
            data = await self._request("GET", self.spec.orderbook_url, params=self._data_params())
            book = (data.get("orderbooks") or {}).get(self.symbol) or {}
            bids = [(float(lvl["p"]), float(lvl["s"])) for lvl in book.get("b", [])]
            asks = [(float(lvl["p"]), float(lvl["s"])) for lvl in book.get("a", [])]
            ts = book.get("t")
        else:
            data = await self._request("GET", self.spec.latest_quote_url, params=self._data_params())
            quote = (data.get("quotes") or {}).get(self.symbol) or {}
            bids = [(float(quote["bp"]), float(quote.get("bs", 0.0)))] if quote.get("bp") else []
            asks = [(float(quote["ap"]), float(quote.get("as", 0.0)))] if quote.get("ap") else []
            ts = quote.get("t")
        return bids, asks, parse_venue_ts(ts) if ts else None

    async def get_recent_trades(self, start_iso: str, limit: int = 1000) -> list[dict]:
        """Trades at or after start_iso, oldest first. `start` is required:
        without it the endpoint returns the first trades of the UTC day."""
        data = await self._request(
            "GET", self.spec.recent_trades_url, params=self._data_params(start=start_iso, limit=limit, sort="asc")
        )
        return (data.get("trades") or {}).get(self.symbol) or []

    async def get_minute_bars(self, start_iso: str, limit: int = 1000) -> list[dict]:
        data = await self._request(
            "GET", self.spec.bars_url, params=self._data_params(start=start_iso, timeframe="1Min", limit=limit)
        )
        return (data.get("bars") or {}).get(self.symbol) or []


async def alpaca_client_from_db(
    db: AsyncSession, spec: AssetSpec, order_prefix: str, id_namespace: str = ""
) -> AlpacaPaperClient:
    row = (await db.execute(select(ApiKey).where(ApiKey.provider == "alpaca_paper"))).scalar_one_or_none()
    if row is None or not row.is_valid:
        raise AlpacaConfigError("No valid Alpaca paper key. Add one under Settings → JEV Lab.")
    plain = decrypt_key(row.encrypted_key)
    parsed = parse_alpaca_key(plain) if plain else None
    if parsed is None:
        raise AlpacaConfigError("The stored Alpaca key could not be read. Save it again in Settings.")
    key_id, secret = parsed
    return AlpacaPaperClient(
        key_id, secret, spec=spec, order_prefix=order_prefix, limiter=limiter_for(key_id), id_namespace=id_namespace
    )
