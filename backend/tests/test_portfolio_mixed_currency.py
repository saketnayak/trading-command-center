"""Portfolio totals across quote currencies (a USD and an ASX holding in one portfolio)."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.routers import portfolio as portfolio_router
from app.schemas.money import PriceQuote
from app.services import fx_service
from main import app
from tests.test_portfolio_integration import _auth, _create_portfolio, _register_and_login


@pytest.fixture
def aud_rate(fixed_fx):
    """1 USD = 1.5 AUD, with no network call."""
    return fixed_fx({"USD": 1.0, "AUD": 1.5})


@pytest.mark.unit
async def test_convert_rate_goes_through_usd_and_refuses_unknown_rates(aud_rate, fixed_fx):
    assert await fx_service.convert_rate("AUD", "AUD") == 1.0
    assert await fx_service.convert_rate("USD", "AUD") == 1.5
    assert await fx_service.convert_rate("AUD", "USD") == pytest.approx(1 / 1.5)
    assert await fx_service.convert_rate("AUD", "EUR") is None  # no EUR rate in this snapshot
    assert await fx_service.convert_rate("HKD", "USD") is None  # no HKD rate in this snapshot
    fixed_fx({"USD": 1.0})  # what a failed refresh leaves
    assert await fx_service.convert_rate("AUD", "USD") is None


async def _mixed_portfolio(client, email):
    token = await _register_and_login(client, email)
    pid = await _create_portfolio(client, token)
    csv = b"ticker,shares,avg_cost\nAAPL,10,100\nCSL.AX,4,150\n"
    r = await client.post(f"/portfolio/{pid}/upload", files={"file": ("h.csv", csv, "text/csv")}, headers=_auth(token))
    assert r.status_code == 200, r.text
    current = (await client.get(f"/portfolio/{pid}/current", headers=_auth(token))).json()
    csl = next(h for h in current["holdings"] if h["ticker"] == "CSL.AX")
    r = await client.patch(f"/portfolio/{pid}/holdings/{csl['id']}", json={"currency": "AUD"}, headers=_auth(token))
    assert r.status_code == 204, r.text
    return token, pid


def _prices(monkeypatch):
    quotes = {"AAPL": PriceQuote(amount=200.0, currency="USD"), "CSL.AX": PriceQuote(amount=300.0, currency="AUD")}

    async def fake_bulk(tickers, *_args, **_kwargs):
        return {t: quotes[t] for t in tickers if t in quotes}

    monkeypatch.setattr(portfolio_router, "_fetch_prices_bulk", fake_bulk)


@pytest.mark.asyncio
async def test_totals_convert_holdings_quoted_in_another_currency(aud_rate, monkeypatch):
    _prices(monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, pid = await _mixed_portfolio(client, "mixedccy1@example.com")
        body = (await client.get(f"/portfolio/{pid}/current", headers=_auth(token))).json()

    # AAPL 10 × $200 = $2,000; CSL.AX 4 × A$300 = A$1,200 = $800. Cost $1,000 + A$600 ($400).
    assert body["totals_currency"] == "USD"
    assert body["totals"]["market_value"] == pytest.approx(2800.0)
    assert body["totals"]["unrealized_pnl"] == pytest.approx(1400.0)
    assert body["totals"]["unrealized_pnl_pct"] == pytest.approx(100.0)
    assert body["totals_excluded"] == []
    csl = next(h for h in body["holdings"] if h["ticker"] == "CSL.AX")
    assert csl["market_value"] == pytest.approx(1200.0) and csl["quote_currency"] == "AUD"  # rows stay in AUD


@pytest.mark.asyncio
async def test_totals_name_holdings_left_out_when_there_is_no_rate(monkeypatch, fixed_fx):
    fixed_fx({"USD": 1.0})
    _prices(monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, pid = await _mixed_portfolio(client, "mixedccy2@example.com")
        body = (await client.get(f"/portfolio/{pid}/current", headers=_auth(token))).json()

    assert body["totals"]["market_value"] == pytest.approx(2000.0)
    assert body["totals_excluded"] == ["CSL.AX"]
