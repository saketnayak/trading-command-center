import inspect
import json
import re

import httpx

import pytest

import app.services.alpaca_paper_client as alpaca_module
from app.services.alpaca_paper_client import (
    PAPER_TRADING_BASE_URL,
    AlpacaAPIError,
    AlpacaPaperClient,
    MarketClosedError,
    new_order_prefix,
    parse_alpaca_key,
)
from app.services.jev_rate_limiter import AsyncRateLimiter
from jev_loop.assets import resolve_symbol

pytestmark = pytest.mark.unit

BTC = resolve_symbol("BTC/USD")
AAPL = resolve_symbol("AAPL")
ORDERS = f"{PAPER_TRADING_BASE_URL}/v2/orders"


def _client(spec=BTC, prefix="jevlab-test-") -> AlpacaPaperClient:
    return AlpacaPaperClient("PKTEST", "secret", spec=spec, order_prefix=prefix, limiter=AsyncRateLimiter(1000))


# -- paper only, structurally ------------------------------------------------


def test_there_is_no_live_trading_url_anywhere_in_the_client():
    source = inspect.getsource(alpaca_module)
    assert "https://api.alpaca.markets" not in source
    assert PAPER_TRADING_BASE_URL == "https://paper-api.alpaca.markets"


def test_the_constructor_takes_no_base_url():
    assert "base_url" not in inspect.signature(AlpacaPaperClient.__init__).parameters


def test_order_prefix_is_unique_and_recognisable():
    a, b = new_order_prefix(), new_order_prefix()
    assert a != b and re.fullmatch(r"jevlab-[0-9a-f]{8}-", a)


def test_parse_alpaca_key():
    assert parse_alpaca_key(json.dumps({"key_id": "PK1", "secret": "s"})) == ("PK1", "s")
    assert parse_alpaca_key("nope") is None
    assert parse_alpaca_key(json.dumps({"key_id": "PK1"})) is None


# -- orders ----------------------------------------------------------------


async def test_orders_carry_the_session_prefix_and_auth_headers(httpx_mock):
    httpx_mock.add_response(url=ORDERS, method="POST", json={"id": "o1"}, is_reusable=True)
    async with _client() as c:
        await c.submit_limit_order("buy", 0.0002, 99_990.123)
        await c.submit_market_order("sell", 0.0001)
    reqs = httpx_mock.get_requests()
    bodies = [json.loads(r.content) for r in reqs]
    assert [b["client_order_id"] for b in bodies] == ["jevlab-test-1", "jevlab-test-2"]
    assert bodies[0] == {
        "symbol": "BTC/USD",
        "qty": "0.00020000",
        "side": "buy",
        "type": "limit",
        "time_in_force": "gtc",
        "limit_price": "99990.12",
        "client_order_id": "jevlab-test-1",
    }
    assert reqs[0].headers["APCA-API-KEY-ID"] == "PKTEST"


async def test_equity_orders_use_day_time_in_force(httpx_mock):
    # Alpaca rejects fractional equity orders that are not DAY; upstream sent GTC.
    httpx_mock.add_response(url=f"{PAPER_TRADING_BASE_URL}/v2/clock", json={"is_open": True})
    httpx_mock.add_response(url=ORDERS, method="POST", json={"id": "o1"})
    async with _client(spec=AAPL) as c:
        await c.submit_limit_order("buy", 0.05, 230.0)
    body = json.loads(httpx_mock.get_requests()[-1].content)
    assert body["time_in_force"] == "day"


async def test_equity_order_refused_while_market_closed(httpx_mock):
    httpx_mock.add_response(url=f"{PAPER_TRADING_BASE_URL}/v2/clock", json={"is_open": False})
    async with _client(spec=AAPL) as c:
        with pytest.raises(MarketClosedError):
            await c.submit_market_order("buy", 0.05)
    assert all(r.method == "GET" for r in httpx_mock.get_requests())


async def test_cheap_crypto_limit_price_keeps_its_precision(httpx_mock):
    httpx_mock.add_response(url=ORDERS, method="POST", json={"id": "o1"})
    async with _client(spec=resolve_symbol("DOGE/USD")) as c:
        await c.submit_limit_order("buy", 100.0, 0.123456)
    assert json.loads(httpx_mock.get_requests()[0].content)["limit_price"] == "0.123456"


async def test_cancel_own_orders_never_touches_other_orders(httpx_mock):
    httpx_mock.add_response(
        url=f"{ORDERS}?status=open&limit=500",
        json=[
            {"id": "mine", "client_order_id": "jevlab-test-1"},
            {"id": "manual", "client_order_id": "someone-else"},
            {"id": "mine-filled", "client_order_id": "jevlab-test-2"},
        ],
    )
    httpx_mock.add_response(url=f"{ORDERS}/mine", method="DELETE", status_code=204)
    httpx_mock.add_response(url=f"{ORDERS}/mine-filled", method="DELETE", status_code=422, json={"message": "filled"})
    async with _client() as c:
        assert await c.cancel_own_orders() == 1
    deletes = [str(r.url) for r in httpx_mock.get_requests() if r.method == "DELETE"]
    assert deletes == [f"{ORDERS}/mine", f"{ORDERS}/mine-filled"]


async def test_position_404_means_flat(httpx_mock):
    httpx_mock.add_response(url=f"{PAPER_TRADING_BASE_URL}/v2/positions/BTCUSD", status_code=404, json={})
    async with _client() as c:
        assert await c.get_position_qty() == 0.0


async def test_401_explains_paper_vs_live(httpx_mock):
    httpx_mock.add_response(url=f"{PAPER_TRADING_BASE_URL}/v2/account", status_code=401, text="unauthorized")
    async with _client() as c:
        with pytest.raises(AlpacaAPIError) as exc:
            await c.get_account()
    assert exc.value.status_code == 401 and "paper" in str(exc.value).lower()


# -- market data -------------------------------------------------------------


async def test_crypto_top_of_book_returns_depth_and_the_venue_timestamp(httpx_mock):
    httpx_mock.add_response(
        url="https://data.alpaca.markets/v1beta3/crypto/us/latest/orderbooks?symbols=BTC%2FUSD",
        json={
            "orderbooks": {
                "BTC/USD": {
                    "t": "2026-09-24T21:44:30.980346366Z",
                    "b": [{"p": 99990.0, "s": 0.5}, {"p": 99980.0, "s": 0.4}],
                    "a": [{"p": 100010.0, "s": 0.3}],
                }
            }
        },
    )
    async with _client() as c:
        bids, asks, venue_ts = await c.read_top_of_book()
    assert bids == [(99990.0, 0.5), (99980.0, 0.4)] and asks == [(100010.0, 0.3)]
    assert venue_ts == pytest.approx(1790286270.980346, abs=1e-3)


async def test_equity_top_of_book_uses_the_iex_quote(httpx_mock):
    httpx_mock.add_response(
        url="https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=AAPL&feed=iex",
        json={"quotes": {"AAPL": {"t": "2026-09-24T15:00:00Z", "bp": 229.9, "bs": 3, "ap": 230.1, "as": 2}}},
    )
    async with _client(spec=AAPL) as c:
        bids, asks, _ = await c.read_top_of_book()
    assert bids == [(229.9, 3.0)] and asks == [(230.1, 2.0)]


async def test_recent_trades_require_a_start(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r"https://data\.alpaca\.markets/v1beta3/crypto/us/trades\?.*start=2026.*"),
        json={"trades": {"BTC/USD": [{"t": "2026-09-24T21:44:30Z", "p": 1.0, "s": 2.0, "tks": "B", "i": 7}]}},
    )
    async with _client() as c:
        trades = await c.get_recent_trades("2026-09-24T21:44:00Z")
    assert trades[0]["i"] == 7


async def test_every_request_goes_through_the_shared_limiter(httpx_mock):
    httpx_mock.add_response(url=f"{PAPER_TRADING_BASE_URL}/v2/account", json={"equity": "100000"})
    calls = []

    class CountingLimiter:
        async def acquire(self):
            calls.append(1)

    async with AlpacaPaperClient("PKTEST", "s", spec=BTC, order_prefix="p-", limiter=CountingLimiter()) as c:
        await c.get_account()
    assert calls == [1]


async def test_an_id_namespace_keeps_client_order_ids_unique_across_clients(httpx_mock):
    # A flatten after a restart reuses the session prefix; a fresh sequence must not collide.
    httpx_mock.add_response(url=ORDERS, method="POST", json={"id": "o1"})
    c = AlpacaPaperClient("PKTEST", "s", spec=BTC, order_prefix="jevlab-test-", limiter=AsyncRateLimiter(1000), id_namespace="f1a2-")
    async with c:
        await c.submit_market_order("sell", 0.0001)
    assert json.loads(httpx_mock.get_requests()[0].content)["client_order_id"] == "jevlab-test-f1a2-1"


@pytest.mark.parametrize("exc", [httpx.ReadTimeout("slow"), httpx.ConnectError("refused")])
async def test_network_failures_become_alpaca_errors_not_crashes(httpx_mock, exc):
    # Regression: a ReadTimeout on GET /v2/account escaped as a raw httpx error
    # and crashed a paper session before its first tick.
    httpx_mock.add_exception(exc, url=f"{PAPER_TRADING_BASE_URL}/v2/account")
    async with _client() as c:
        with pytest.raises(AlpacaAPIError) as err:
            await c.get_account()
    assert type(exc).__name__ in str(err.value)
