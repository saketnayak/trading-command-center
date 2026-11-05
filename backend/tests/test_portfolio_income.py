"""Integration tests: dividend store and GET /portfolio/{id}/income (yfinance faked)."""
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models.dividend import DividendHistory, DividendSync
from app.services import dividend_service
from tests.test_portfolio_performance import TODAY, _client, _portfolio, _token
from tests.test_portfolio_rebalance import flat_prices  # noqa: F401 - AAA 100, BBB 50, NEW 20, BTC-USD 1000

# AAA: quarterly 1.00 (four a year) for six years; BBB: monthly 0.10; NEW and BTC-USD: none.
DIVS = {
    "AAA": [(TODAY - timedelta(days=30 + 91 * i), 1.0) for i in range(24)],
    "BBB": [(TODAY - timedelta(days=10 + 30 * i), 0.10) for i in range(24)],
}
CALLS: list[str] = []


@pytest.fixture
def fake_divs(monkeypatch):
    CALLS.clear()

    async def _fake(symbol):
        CALLS.append(symbol)
        if symbol == "BROKEN":
            raise ValueError("Too Many Requests")
        return sorted(DIVS.get(symbol, []))

    monkeypatch.setattr(dividend_service, "_download_dividends", _fake)
    monkeypatch.setattr(dividend_service, "RETRY_DELAYS_S", (0.0,))
    dividend_service._recent_failures.clear()


async def test_store_records_non_payers_and_reuses_fresh_history(fake_divs):
    async with AsyncSessionLocal() as db:
        assert await dividend_service.refresh(db, ["AAA", "NEW", "BROKEN"]) == {"BROKEN"}
        assert (await db.execute(select(func.count()).select_from(DividendHistory).where(DividendHistory.symbol == "AAA"))).scalar_one() == 24
        sync = {r.symbol: r.payments for r in (await db.execute(select(DividendSync))).scalars()}
        assert sync == {"AAA": 24, "NEW": 0}  # a non-payer is remembered, a failure is not
        await dividend_service.refresh(db, ["AAA", "NEW"])
        assert CALLS.count("AAA") == 1 and CALLS.count("NEW") == 1  # fresh: not fetched again
        assert await dividend_service.refresh(db, ["BROKEN"]) == {"BROKEN"}
        assert CALLS.count("BROKEN") == 2  # first try + one retry, then the cooldown holds


async def test_income_report(fake_divs, flat_prices):  # noqa: F811
    async with _client() as c:
        h = await _token(c, "inc1@example.com")
        # AAA 100 sh @ $100 (avg cost 100); BBB 200 sh @ $50; BTC-USD 1 (no dividend)
        pid = await _portfolio(c, h, [(1, {"AAA": 100, "BBB": 200, "BTC-USD": 1})])
        body = (await c.get(f"/portfolio/{pid}/income", headers=h)).json()
    t = body["totals"]
    # AAA: 4 × $1 × 100 = $400; BBB: 12 × $0.10 × 200 = $240
    assert t["annual_income"] == pytest.approx(640.0)
    assert t["monthly_income"] == pytest.approx(640 / 12, abs=0.01)
    assert t["portfolio_value"] == pytest.approx(100 * 100 + 200 * 50 + 1000)
    assert t["yield"] == pytest.approx(640 / 21000, abs=1e-6)
    # Over the whole cost basis, non-payers included (the helper gives every holding avg cost 100).
    assert t["yield_on_cost"] == pytest.approx(640 / (100 * 100 + 200 * 100 + 1 * 100), abs=1e-6)
    assert t["payers"] == 2 and t["holdings"] == 3
    rows = {r["ticker"]: r for r in body["holdings"]}
    assert rows["AAA"]["frequency"] == "quarterly" and rows["AAA"]["yield"] == pytest.approx(0.04)
    assert rows["BBB"]["frequency"] == "monthly" and rows["BBB"]["annual_income"] == pytest.approx(240.0)
    assert rows["BTC-USD"]["frequency"] is None and rows["BTC-USD"]["annual_income"] == 0
    assert len(body["calendar"]) == 12
    assert sum(m["amount"] for m in body["calendar"]) == pytest.approx(640.0, abs=1.0)
    assert body["received"]["source"] == "estimate" and body["received"]["last_12_months"] > 0
    assert body["projection"]["years"][0]["with_drip"] == pytest.approx(640.0)
    assert body["target_monthly"] is None and "goal_progress" not in t


async def test_target_ledger_received_and_ownership(fake_divs, flat_prices):  # noqa: F811
    async with _client() as c, _client() as other:
        h = await _token(c, "inc2@example.com")
        oh = await _token(other, "inc3@example.com")
        pid = (await c.post("/portfolio", json={"name": "Inc"}, headers=h)).json()["id"]
        d = lambda n: (TODAY - timedelta(days=n)).isoformat()  # noqa: E731
        await c.post(f"/portfolio/{pid}/transactions/import", headers=h, json={"dry_run": False, "rows": [
            {"trade_date": d(400), "type": "BUY", "symbol": "AAA", "quantity": 50, "price": 90},
            {"trade_date": d(40), "type": "DIVIDEND", "symbol": "AAA", "amount": 50},
            {"trade_date": d(130), "type": "DIVIDEND", "symbol": "AAA", "amount": 50},
        ]})
        assert (await c.put(f"/portfolio/{pid}/income/target", headers=h, json={"monthly": 100})).json() == {"monthly": 100.0}
        body = (await c.get(f"/portfolio/{pid}/income", headers=h)).json()
        assert body["received"]["source"] == "ledger" and body["received"]["last_12_months"] == pytest.approx(100.0)
        assert body["totals"]["annual_income"] == pytest.approx(200.0)  # 50 shares × $4
        assert body["totals"]["goal_progress"] == pytest.approx((200 / 12) / 100, abs=1e-3)
        assert body["holdings"][0]["yield_on_cost"] == pytest.approx(4 / 90, abs=1e-6)
        assert (await c.put(f"/portfolio/{pid}/income/target", headers=h, json={"monthly": -5})).status_code == 422
        assert (await c.put(f"/portfolio/{pid}/income/target", headers=h, json={"monthly": None})).json() == {"monthly": None}
        assert (await other.get(f"/portfolio/{pid}/income", headers=oh)).status_code == 404
        empty = (await c.post("/portfolio", json={"name": "Empty"}, headers=h)).json()["id"]
        assert (await c.get(f"/portfolio/{empty}/income", headers=h)).json()["message"]
