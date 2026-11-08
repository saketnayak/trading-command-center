"""Integration tests: /net-worth and its items (prices and wallet balances faked)."""
from datetime import timedelta

import pytest

from app.services import price_history_service, wallet_service
from tests.test_portfolio_performance import TODAY, _client, _portfolio, _token

PRICES = {"NWA": 100.0, "BTC-USD": 40_000.0, "SPY": 500.0}
BALANCES = {"bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh": 0.5}


@pytest.fixture
def fakes(monkeypatch):
    async def _closes(symbol, start):
        if symbol not in PRICES:
            raise ValueError("unknown")
        out, d = {}, start
        while d <= TODAY:
            out[d] = PRICES[symbol]
            d += timedelta(days=1)
        return out

    async def _balance(chain, address):
        if address not in BALANCES:
            raise ValueError("HTTP 503")
        return BALANCES[address]

    monkeypatch.setattr(price_history_service, "_download_closes", _closes)
    monkeypatch.setattr(price_history_service, "RETRY_DELAYS_S", (0.0,))
    price_history_service._recent_failures.clear()
    monkeypatch.setattr(wallet_service, "fetch_balance", _balance)


def _d(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).isoformat()


async def test_net_worth_items_wallets_and_series(fakes):
    async with _client() as c, _client() as other:
        h = await _token(c, "nw1@example.com")
        oh = await _token(other, "nw2@example.com")
        await _portfolio(c, h, [(1, {"NWA": 50})])  # $5,000

        house = await c.post("/net-worth/items", headers=h, json={
            "kind": "asset", "category": "real_estate", "name": "House", "value": 300_000, "as_of": _d(60)})
        assert house.status_code == 201, house.text
        house_id = house.json()["id"]
        loan = await c.post("/net-worth/items", headers=h, json={
            "kind": "liability", "category": "mortgage", "name": "Mortgage", "value": 200_000, "as_of": _d(60)})
        loan_id = loan.json()["id"]
        wallet = await c.post("/net-worth/items", headers=h, json={
            "category": "crypto_wallet", "name": "Cold wallet", "wallet_chain": "btc",
            "wallet_address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"})
        assert wallet.status_code == 201 and wallet.json()["sync_error"] is None
        wallet_id = wallet.json()["id"]

        # Validation.
        bad = [
            {"kind": "asset", "category": "mortgage", "name": "x", "value": 1},
            {"kind": "liability", "category": "cash", "name": "x", "value": 1},
            {"kind": "asset", "category": "cash", "name": "x"},
            {"kind": "asset", "category": "cash", "name": "x", "value": 1, "currency": "XYZ"},
            {"category": "crypto_wallet", "name": "x", "wallet_chain": "eth", "wallet_address": "bc1qnope"},
            {"kind": "asset", "category": "crypto_wallet", "name": "x", "value": 1},
        ]
        for body in bad:
            assert (await c.post("/net-worth/items", headers=h, json=body)).status_code == 422, body

        nw = (await c.get("/net-worth?range=1y", headers=h)).json()
        assert nw["investments"] == 5000 and nw["assets"] == 5000 + 300_000 + 20_000
        assert nw["liabilities"] == 200_000 and nw["net_worth"] == 125_000
        assert nw["series"][-1]["net_worth"] == 125_000 and nw["series"][-1]["date"] == TODAY.isoformat()
        # Items count from their first recorded value: the house and mortgage 60 days ago, the wallet today.
        assert nw["series"][0]["other_assets"] == 0 and nw["series"][0]["liabilities"] == 0
        by = {r["category"]: r["value"] for r in nw["assets_by_category"]}
        assert by == {"real_estate": 300_000, "crypto_wallet": 20_000, "investments": 5000}
        w = next(i for i in nw["items"] if i["id"] == wallet_id)
        assert w["balance"] == 0.5 and w["value_display"] == 20_000 and w["value"] is None

        # Recording values.
        assert (await c.patch(f"/net-worth/items/{loan_id}", headers=h, json={"value": 190_000})).status_code == 200
        assert (await c.post(f"/net-worth/items/{house_id}/valuations", headers=h,
                             json={"date": _d(400), "value": 250_000})).status_code == 200
        assert (await c.post(f"/net-worth/items/{house_id}/valuations", headers=h,
                             json={"date": (TODAY + timedelta(days=1)).isoformat(), "value": 1})).status_code == 422
        nw = (await c.get("/net-worth?range=1y", headers=h)).json()
        assert nw["net_worth"] == 135_000
        house_row = next(i for i in nw["items"] if i["id"] == house_id)
        assert [v["date"] for v in house_row["valuations"]] == [_d(400), _d(60)]
        assert nw["series"][0]["other_assets"] == 250_000  # the older value now covers the start
        assert nw["change"]["amount"] == 135_000 - nw["series"][0]["net_worth"]

        assert (await c.delete(f"/net-worth/items/{house_id}/valuations/{_d(5)}", headers=h)).status_code == 404
        assert (await c.delete(f"/net-worth/items/{house_id}/valuations/{_d(400)}", headers=h)).status_code == 204
        assert (await c.delete(f"/net-worth/items/{house_id}/valuations/{_d(60)}", headers=h)).status_code == 409

        # Wallets sync from their address and can't be valued by hand.
        assert (await c.patch(f"/net-worth/items/{wallet_id}", headers=h, json={"value": 5})).status_code == 422
        BALANCES.clear()
        sync = (await c.post(f"/net-worth/items/{wallet_id}/sync", headers=h)).json()
        assert sync["ok"] is False and "Could not read the balance" in sync["sync_error"]
        nw = (await c.get("/net-worth", headers=h)).json()
        assert next(i for i in nw["items"] if i["id"] == wallet_id)["balance"] == 0.5  # kept
        assert (await c.post(f"/net-worth/items/{house_id}/sync", headers=h)).status_code == 422

        # Ownership, ranges, delete.
        assert (await other.patch(f"/net-worth/items/{house_id}", headers=oh, json={"name": "Mine"})).status_code == 404
        assert (await other.get("/net-worth", headers=oh)).json()["items"] == []
        assert (await c.get("/net-worth?range=10y", headers=h)).status_code == 422
        assert (await c.delete(f"/net-worth/items/{loan_id}", headers=h)).status_code == 204
        assert (await c.get("/net-worth", headers=h)).json()["liabilities"] == 0


async def test_net_worth_in_any_currency_names_items_without_a_rate(fakes, fixed_fx):
    fixed_fx({"USD": 1.0, "AUD": 1.5})
    async with _client() as c:
        h = await _token(c, "nwccy@example.com")
        await c.post("/net-worth/items", headers=h, json={
            "kind": "asset", "category": "cash", "name": "Synthetic AUD cash", "currency": "AUD",
            "value": 1500, "as_of": _d(10)})
        chf = await c.post("/net-worth/items", headers=h, json={
            "kind": "asset", "category": "cash", "name": "Synthetic CHF account", "currency": "CHF",
            "value": 1000, "as_of": _d(10)})
        chf_id = chf.json()["id"]
        aud = (await c.get("/net-worth?range=1y&currency=aud", headers=h)).json()
        usd = (await c.get("/net-worth?range=1y&currency=USD", headers=h)).json()
        bad = await c.get("/net-worth?range=1y&currency=XYZ", headers=h)

    assert aud["display_currency"] == "AUD"
    assert aud["excluded"] == [{"id": chf_id, "name": "Synthetic CHF account", "currency": "CHF"}]
    assert "No AUD exchange rate for Synthetic CHF account (CHF); left out." in aud["warnings"]
    assert aud["assets"] == pytest.approx(1500.0)
    chf_row = next(i for i in aud["items"] if i["id"] == chf_id)
    assert chf_row["value"] == 1000 and chf_row["value_display"] is None
    assert usd["assets"] == pytest.approx(1000.0)
    assert usd["fx"]["source"] == "live" and usd["fx"]["rates_used"] == {"AUD": pytest.approx(1 / 1.5)}
    assert bad.status_code == 422
