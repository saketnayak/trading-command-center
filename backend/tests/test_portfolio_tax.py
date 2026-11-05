"""Integration tests: GET /portfolio/{id}/tax and /tax/replacements (prices faked)."""
from datetime import timedelta

import pytest

from app.services import price_history_service
from tests.test_portfolio_performance import TODAY, _client, _portfolio, _token

PRICES = {"TAXA": 90.0, "TAXB": 40.0}


@pytest.fixture
def tax_prices(monkeypatch):
    async def _fake(symbol, start):
        if symbol not in PRICES:
            raise ValueError("unknown")
        out, d = {}, start
        while d <= TODAY:
            out[d] = PRICES[symbol]
            d += timedelta(days=1)
        return out

    monkeypatch.setattr(price_history_service, "_download_closes", _fake)
    monkeypatch.setattr(price_history_service, "RETRY_DELAYS_S", (0.0,))
    price_history_service._recent_failures.clear()


def _d(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).isoformat()


async def _add(c, h, pid, **tx):
    r = await c.post(f"/portfolio/{pid}/transactions", headers=h, json=tx)
    assert r.status_code == 201, r.text


async def test_tax_report_wash_sales_and_harvest(tax_prices):
    async with _client() as c, _client() as other:
        h = await _token(c, "tax1@example.com")
        oh = await _token(other, "tax2@example.com")
        snap_only = await _portfolio(c, h, [(1, {"TAXA": 1})])
        main = (await c.post("/portfolio", headers=h, json={"name": "Taxable"})).json()["id"]
        second = (await c.post("/portfolio", headers=h, json={"name": "Second"})).json()["id"]

        await _add(c, h, main, trade_date=_d(500), type="BUY", symbol="TAXA", quantity=10, price=100)
        await _add(c, h, main, trade_date=_d(100), type="SELL", symbol="TAXA", quantity=10, price=80)  # −$200, long
        await _add(c, h, main, trade_date=_d(90), type="BUY", symbol="TAXA", quantity=5, price=82)  # washes half
        await _add(c, h, main, trade_date=_d(200), type="BUY", symbol="TAXB", quantity=20, price=50)  # −$200 open
        await _add(c, h, second, trade_date=_d(5), type="BUY", symbol="TAXB", quantity=1, price=45)  # other portfolio

        year = (TODAY - timedelta(days=100)).year
        body = (await c.get(f"/portfolio/{main}/tax?year={year}&min_loss=100", headers=h)).json()
        assert body["available"] and year in body["years"] and "not tax advice" in body["disclaimer"]
        (row,) = body["report"]["rows"]
        assert row["symbol"] == "TAXA" and row["term"] == "long" and row["gain"] == -200
        assert row["code"] == "W" and row["adjustment"] == 100 and row["adjusted_gain"] == -100
        assert row["replacements"] == [{"date": _d(90), "account": "Main", "portfolio": "Taxable", "quantity": 5}]
        (totals,) = body["report"]["totals"]
        assert totals["long"]["adjusted_gain"] == -100 and totals["net"] == -100
        assert [w["symbol"] for w in body["wash_sales"]] == ["TAXA"]

        (cand,) = body["harvest"]  # TAXA's open lot is at a gain (82 → 90)
        assert cand["symbol"] == "TAXB" and cand["loss"] == -200 and cand["term"] == "short"
        assert cand["recent_buys"] == [{"date": _d(5), "account": "Main", "portfolio": "Second", "quantity": 1}]
        assert (await c.get(f"/portfolio/{main}/tax?min_loss=500", headers=h)).json()["harvest"] == []

        off = (await c.get(f"/portfolio/{snap_only}/tax", headers=h)).json()
        assert off["available"] is False and "transaction ledger" in off["message"]
        assert (await other.get(f"/portfolio/{main}/tax", headers=oh)).status_code == 404

        rep = await c.get(f"/portfolio/{main}/tax/replacements?symbol=taxb", headers=h)
        assert rep.status_code == 200 and rep.json()["symbol"] == "TAXB" and rep.json()["ideas"] == []
        assert (await c.get(f"/portfolio/{main}/tax/replacements?symbol=$$", headers=h)).status_code == 422
        assert (await other.get(f"/portfolio/{main}/tax/replacements?symbol=TAXB", headers=oh)).status_code == 404
