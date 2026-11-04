"""Integration tests: target CRUD and GET /portfolio/{id}/rebalance (prices faked)."""
from datetime import date, timedelta

import pytest

from app.services import price_history_service
from tests.test_portfolio_performance import TODAY, _client, _portfolio, _token

FLAT = {"AAA": 100.0, "BBB": 50.0, "NEW": 20.0, "BTC-USD": 1000.0}


@pytest.fixture
def flat_prices(monkeypatch):
    async def _fake(symbol: str, start: date):
        if symbol not in FLAT:
            raise ValueError("unknown")
        out, d = {}, start
        while d <= TODAY:
            out[d] = FLAT[symbol]
            d += timedelta(days=1)
        return out

    monkeypatch.setattr(price_history_service, "_download_closes", _fake)
    monkeypatch.setattr(price_history_service, "RETRY_DELAYS_S", (0.0,))
    price_history_service._recent_failures.clear()


async def test_targets_crud_and_validation(flat_prices):
    async with _client() as c, _client() as other:
        h = await _token(c, "rb1@example.com")
        oh = await _token(other, "rb2@example.com")
        pid = await _portfolio(c, h, [(1, {"AAA": 10})])
        assert (await c.get(f"/portfolio/{pid}/targets", headers=h)).json() == {"targets": [], "default_band": 0.05}

        ok = await c.put(f"/portfolio/{pid}/targets", headers=h, json={"targets": [
            {"ticker": " aaa ", "weight": 0.6}, {"ticker": "BBB", "weight": 0.4, "band": 0.1}]})
        assert ok.status_code == 200, ok.text
        assert ok.json()["targets"] == [{"ticker": "AAA", "weight": 0.6, "band": 0.05},
                                        {"ticker": "BBB", "weight": 0.4, "band": 0.1}]

        for bad in (
            [{"ticker": "AAA", "weight": 0.6}, {"ticker": "BBB", "weight": 0.3}],  # 90%
            [{"ticker": "AAA", "weight": 0.5}, {"ticker": "aaa", "weight": 0.5}],  # duplicate
            [{"ticker": "A A", "weight": 1.0}],
            [{"ticker": "AAA", "weight": 1.0, "band": 0}],
        ):
            assert (await c.put(f"/portfolio/{pid}/targets", headers=h, json={"targets": bad})).status_code == 422, bad

        assert (await other.get(f"/portfolio/{pid}/targets", headers=oh)).status_code == 404
        assert (await other.put(f"/portfolio/{pid}/targets", headers=oh, json={"targets": []})).status_code == 404
        # Clearing is allowed.
        assert (await c.put(f"/portfolio/{pid}/targets", headers=h, json={"targets": []})).json()["targets"] == []


async def test_rebalance_plan_end_to_end(flat_prices):
    async with _client() as c:
        h = await _token(c, "rb3@example.com")
        # AAA 30×100 = 3,000; BBB 20×50 = 1,000 → 75% / 25%
        pid = await _portfolio(c, h, [(1, {"AAA": 30, "BBB": 20})])
        no_targets = (await c.get(f"/portfolio/{pid}/rebalance", headers=h)).json()
        assert no_targets["plan"] is None and "Set target weights" in no_targets["message"]
        assert {r["ticker"]: r["status"] for r in no_targets["drift"]} == {"AAA": "untargeted", "BBB": "untargeted"}

        await c.put(f"/portfolio/{pid}/targets", headers=h, json={"targets": [
            {"ticker": "AAA", "weight": 0.5}, {"ticker": "BBB", "weight": 0.3}, {"ticker": "NEW", "weight": 0.2}]})

        body = (await c.get(f"/portfolio/{pid}/rebalance?mode=full", headers=h)).json()
        assert body["total_value"] == 4000.0
        drift = {r["ticker"]: r for r in body["drift"]}
        assert drift["AAA"]["status"] == "over" and drift["NEW"]["status"] == "not_held"
        trades = {t["ticker"]: (t["action"], t["amount"], t["shares"]) for t in body["plan"]["trades"]}
        assert trades == {"AAA": ("sell", 1000.0, 10.0), "BBB": ("buy", 200.0, 4.0), "NEW": ("buy", 800.0, 40.0)}
        assert body["plan"]["trades"][0]["action"] == "sell"  # sells first
        assert body["plan"]["summary"]["cash_left"] == 0
        assert "never trades" in body["disclaimer"]

        contrib = (await c.get(f"/portfolio/{pid}/rebalance?mode=contribute&amount=1000", headers=h)).json()
        assert all(t["action"] == "buy" for t in contrib["plan"]["trades"])
        assert contrib["plan"]["summary"]["buys"] == pytest.approx(1000.0)

        assert (await c.get(f"/portfolio/{pid}/rebalance?mode=contribute", headers=h)).status_code == 422


async def test_untargeted_and_unpriced_tickers_are_warned(flat_prices):
    async with _client() as c:
        h = await _token(c, "rb4@example.com")
        pid = await _portfolio(c, h, [(1, {"AAA": 10, "BBB": 10, "GHOST": 5})])
        await c.put(f"/portfolio/{pid}/targets", headers=h, json={"targets": [
            {"ticker": "AAA", "weight": 0.5}, {"ticker": "MISSING", "weight": 0.5}]})
        body = (await c.get(f"/portfolio/{pid}/rebalance?mode=full", headers=h)).json()
    w = " ".join(body["warnings"])
    assert "No recent price for GHOST, MISSING" in w
    assert "No target for BBB" in w
    # MISSING can't be priced, so AAA's target is re-normalised to 100% and BBB is sold into it.
    trades = {t["ticker"]: t["action"] for t in body["plan"]["trades"]}
    assert trades == {"BBB": "sell", "AAA": "buy"}
