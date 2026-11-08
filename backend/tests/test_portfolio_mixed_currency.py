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


def _only_aapl_priced(monkeypatch):
    async def fake_bulk(tickers, *_args, **_kwargs):
        return {"AAPL": PriceQuote(amount=200.0, currency="USD")} if "AAPL" in tickers else {}

    monkeypatch.setattr(portfolio_router, "_fetch_prices_bulk", fake_bulk)


async def _usd_cost_portfolio(client, email):
    """Like _mixed_portfolio, but CSL.AX keeps a USD cost basis while it is quoted in AUD."""
    token = await _register_and_login(client, email)
    pid = await _create_portfolio(client, token)
    csv = b"ticker,shares,avg_cost\nAAPL,10,100\nCSL.AX,4,150\n"
    r = await client.post(f"/portfolio/{pid}/upload", files={"file": ("h.csv", csv, "text/csv")}, headers=_auth(token))
    assert r.status_code == 200, r.text
    return token, pid


@pytest.mark.asyncio
async def test_rows_carry_display_values_and_currency_param_overrides_preference(aud_rate, monkeypatch):
    _prices(monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, pid = await _mixed_portfolio(client, "mixedccy3@example.com")
        body = (await client.get(f"/portfolio/{pid}/current?currency=aud", headers=_auth(token))).json()

    assert body["display_currency"] == "AUD" and body["totals_currency"] == "AUD"
    assert body["fx"]["source"] == "live" and body["fx"]["rates_used"] == {"USD": 1.5}
    aapl = next(h for h in body["holdings"] if h["ticker"] == "AAPL")
    assert aapl["market_value"] == 2000.0 and aapl["market_value_display"] == pytest.approx(3000.0)
    assert aapl["current_price_display"] == pytest.approx(300.0) and aapl["fx_rate"] == 1.5
    assert aapl["unrealized_pnl_display"] == pytest.approx(1500.0)
    assert aapl["unrealized_pnl_pct_display"] == pytest.approx(100.0)
    csl = next(h for h in body["holdings"] if h["ticker"] == "CSL.AX")
    assert csl["fx_rate"] == 1.0 and csl["market_value_display"] == pytest.approx(1200.0)
    assert body["totals"]["market_value"] == pytest.approx(4200.0)  # A$3,000 + A$1,200


@pytest.mark.asyncio
async def test_cost_and_quote_in_different_currencies_now_has_display_pnl(aud_rate, monkeypatch):
    _prices(monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, pid = await _usd_cost_portfolio(client, "mixedccy4@example.com")
        body = (await client.get(f"/portfolio/{pid}/current?currency=AUD", headers=_auth(token))).json()

    # CSL.AX: cost 4 × $150 = $600 = A$900; value 4 × A$300 = A$1,200.
    csl = next(h for h in body["holdings"] if h["ticker"] == "CSL.AX")
    assert csl["pnl_unavailable_reason"] == "currency_mismatch" and csl["unrealized_pnl"] is None
    assert csl["unrealized_pnl_display"] == pytest.approx(300.0)
    assert csl["unrealized_pnl_pct_display"] == pytest.approx(33.3333, rel=1e-4)
    # Totals P&L now counts it: AAPL A$3,000 − A$1,500 plus CSL.AX A$300.
    assert body["totals"]["unrealized_pnl"] == pytest.approx(1800.0)
    assert body["fx"]["rates_used"] == {"USD": 1.5}


@pytest.mark.asyncio
async def test_unpriced_holding_has_null_display_fields_and_is_not_excluded(aud_rate, monkeypatch):
    _only_aapl_priced(monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, pid = await _mixed_portfolio(client, "mixedccy5@example.com")
        body = (await client.get(f"/portfolio/{pid}/current", headers=_auth(token))).json()

    csl = next(h for h in body["holdings"] if h["ticker"] == "CSL.AX")
    assert csl["market_value_display"] is None and csl["current_price_display"] is None
    assert csl["unrealized_pnl_display"] is None
    assert body["totals_excluded"] == [] and body["totals"]["market_value"] == pytest.approx(2000.0)


@pytest.mark.asyncio
async def test_unknown_currency_param_is_422(aud_rate, monkeypatch):
    _prices(monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, pid = await _mixed_portfolio(client, "mixedccy6@example.com")
        r = await client.get(f"/portfolio/{pid}/current?currency=XYZ", headers=_auth(token))
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_trim_signal_weights_count_holdings_in_other_currencies(aud_rate, monkeypatch):
    _prices(monkeypatch)

    async def no_regime(tickers):
        return {}

    async def analysed(tickers, *_args):
        from types import SimpleNamespace
        return {t: SimpleNamespace(verdict="hold", previous_verdict=None) for t in tickers}

    weights = {}
    real_score = portfolio_router.score_trim_signal

    def capture(**kwargs):
        weights[kwargs["ticker"]] = kwargs["portfolio_weight_pct"]
        return real_score(**kwargs)

    monkeypatch.setattr(portfolio_router, "get_regime_for_portfolio", no_regime)
    monkeypatch.setattr(portfolio_router, "score_trim_signal", capture)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, pid = await _mixed_portfolio(client, "mixedccy7@example.com")
        monkeypatch.setattr(portfolio_router, "_get_last_runs_for_holdings", analysed)
        r = await client.get(f"/portfolio/{pid}/trim-signals", headers=_auth(token))
    assert r.status_code == 200, r.text

    # $2,000 and A$1,200 = $800: weights 71.43% and 28.57% of $2,800.
    assert weights["AAPL"] == pytest.approx(71.43, rel=1e-3)
    assert weights["CSL.AX"] == pytest.approx(28.57, rel=1e-3)


@pytest.mark.asyncio
async def test_sector_gaps_count_holdings_in_other_currencies(aud_rate, monkeypatch):
    from types import SimpleNamespace

    _prices(monkeypatch)

    async def fake_metadata(tickers, db, key):
        sectors = {"AAPL": "Technology", "CSL.AX": "Health Care"}
        return {t: SimpleNamespace(sector=sectors[t]) for t in tickers}

    monkeypatch.setattr(portfolio_router, "get_many_ticker_metadata", fake_metadata)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, pid = await _mixed_portfolio(client, "mixedccy8@example.com")
        rows = (await client.get(f"/portfolio/{pid}/sector-gaps", headers=_auth(token))).json()

    weights = {r["sector"]: r["your_weight"] for r in rows}
    assert weights["Health Care"] == pytest.approx(0.2857, rel=1e-3)
    assert weights["Technology"] == pytest.approx(0.7143, rel=1e-3)


@pytest.mark.asyncio
async def test_zero_cost_holding_still_counts_in_total_pnl(aud_rate, monkeypatch):
    _prices(monkeypatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "mixedccy9@example.com")
        pid = await _create_portfolio(client, token)
        csv = b"ticker,shares,avg_cost\nAAPL,10,0\n"  # gifted shares
        r = await client.post(f"/portfolio/{pid}/upload", files={"file": ("h.csv", csv, "text/csv")}, headers=_auth(token))
        assert r.status_code == 200, r.text
        body = (await client.get(f"/portfolio/{pid}/current", headers=_auth(token))).json()

    aapl = body["holdings"][0]
    assert aapl["unrealized_pnl_display"] == pytest.approx(2000.0) and aapl["unrealized_pnl_pct_display"] is None
    assert body["totals"]["market_value"] == pytest.approx(2000.0)
