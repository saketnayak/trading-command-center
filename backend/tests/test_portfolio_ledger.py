"""Integration tests: the transaction ledger API, the snapshot lock, and
ledger-driven performance (prices faked)."""
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import desc, select
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.portfolio import PortfolioSnapshot
from tests.test_portfolio_performance import TODAY, _client, _portfolio, _token, fake_prices  # noqa: F401


async def _holdings(pid: str) -> dict[str, tuple[float, float]]:
    async with AsyncSessionLocal() as db:
        snap = (await db.execute(select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == uuid.UUID(pid))
                                 .options(selectinload(PortfolioSnapshot.holdings))
                                 .order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1))).scalar_one()
        return {h.ticker: (round(h.shares, 6), round(h.avg_cost, 4)) for h in snap.holdings}


async def _source(c, h, pid) -> str:
    return next(p for p in (await c.get("/portfolio", headers=h)).json() if p["id"] == pid)["holdings_source"]


def _d(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).isoformat()


async def test_bootstrap_locks_snapshot_writes_and_derives_holdings():
    async with _client() as c:
        h = await _token(c, "led1@example.com")
        pid = await _portfolio(c, h, [(1, {"AAA": 10, "BBB": 4})])  # avg_cost 100 each
        assert await _source(c, h, pid) == "snapshot"

        r = await c.post(f"/portfolio/{pid}/ledger/bootstrap", headers=h, json={"trade_date": _d(200)})
        assert r.status_code == 201, r.text
        assert r.json()["created"] == 2
        assert await _source(c, h, pid) == "ledger"
        assert (await c.post(f"/portfolio/{pid}/ledger/bootstrap", headers=h, json={"trade_date": _d(10)})).status_code == 409

        # Snapshot writes are refused while ledger-backed.
        add = await c.post(f"/portfolio/{pid}/holdings", headers=h, json={"ticker": "ZZZ", "shares": 1, "avg_cost": 1})
        assert add.status_code == 409 and "transaction ledger" in add.json()["detail"]
        files = {"file": ("p.csv", b"Symbol,Quantity,Average Cost\nAAA,1,1\n", "text/csv")}
        assert (await c.post(f"/portfolio/{pid}/upload", headers=h, files=files)).status_code == 409

        sell = await c.post(f"/portfolio/{pid}/transactions", headers=h, json={
            "trade_date": _d(50), "type": "SELL", "symbol": "aaa", "quantity": 4, "price": 130, "fees": 2})
        assert sell.status_code == 201, sell.text
        assert sell.json()["symbol"] == "AAA" and sell.json()["warnings"] == []
        await c.post(f"/portfolio/{pid}/transactions", headers=h, json={
            "trade_date": _d(20), "type": "BUY", "symbol": "CCC", "quantity": 2, "price": 50, "fees": 1})
        assert await _holdings(pid) == {"AAA": (6.0, 100.0), "BBB": (4.0, 100.0), "CCC": (2.0, 50.5)}

        summary = (await c.get(f"/portfolio/{pid}/ledger", headers=h)).json()
        assert summary["transactions"] == 4 and summary["cost_basis_method"] == "fifo"
        assert summary["realised"][0]["gain"] == pytest.approx(4 * 130 - 2 - 400)
        assert summary["realised"][0]["term"] == "short"
        assert {p["symbol"] for p in summary["positions"]} == {"AAA", "BBB", "CCC"}


async def test_validation_oversell_and_edit_delete():
    async with _client() as c:
        h = await _token(c, "led2@example.com")
        pid = (await c.post("/portfolio", json={"name": "L"}, headers=h)).json()["id"]
        bad = [
            {"trade_date": _d(-5), "type": "BUY", "symbol": "AAA", "quantity": 1, "price": 1},  # future
            {"trade_date": _d(1), "type": "BUY", "symbol": "AAA", "quantity": 0, "price": 1},
            {"trade_date": _d(1), "type": "DIVIDEND", "symbol": "AAA"},  # no amount
            {"trade_date": _d(1), "type": "MOON", "symbol": "AAA"},
            {"trade_date": _d(1), "type": "BUY", "symbol": "A A", "quantity": 1, "price": 1},
        ]
        for body in bad:
            assert (await c.post(f"/portfolio/{pid}/transactions", headers=h, json=body)).status_code == 422, body

        buy = (await c.post(f"/portfolio/{pid}/transactions", headers=h, json={
            "trade_date": _d(30), "type": "BUY", "symbol": "AAA", "quantity": 5, "price": 10})).json()
        over = (await c.post(f"/portfolio/{pid}/transactions", headers=h, json={
            "trade_date": _d(10), "type": "SELL", "symbol": "AAA", "quantity": 8, "price": 12})).json()
        assert over["warnings"] and "only 5 were held" in over["warnings"][0]
        assert await _holdings(pid) == {}

        fixed = await c.patch(f"/portfolio/{pid}/transactions/{over['id']}", headers=h, json={"quantity": 2})
        assert fixed.status_code == 200 and fixed.json()["warnings"] == []
        assert await _holdings(pid) == {"AAA": (3.0, 10.0)}
        assert (await c.patch(f"/portfolio/{pid}/transactions/{over['id']}", headers=h, json={"quantity": -1})).status_code == 422

        assert (await c.delete(f"/portfolio/{pid}/transactions/{over['id']}", headers=h)).status_code == 204
        assert (await c.delete(f"/portfolio/{pid}/transactions/{buy['id']}", headers=h)).status_code == 204
        assert await _source(c, h, pid) == "snapshot"  # empty ledger → back to snapshot holdings


async def test_import_dry_run_then_commit_and_method_switch():
    rows = [
        {"trade_date": _d(500), "type": "BUY", "symbol": "AAA", "quantity": 10, "price": 100},  # held 400 days → long
        {"trade_date": _d(300), "type": "BUY", "symbol": "AAA", "quantity": 10, "price": 200},  # held 200 days → short
        {"trade_date": _d(100), "type": "SELL", "symbol": "AAA", "quantity": 10, "price": 250},
        {"trade_date": _d(90), "type": "DIVIDEND", "symbol": "AAA", "amount": 15.5},
    ]
    async with _client() as c, _client() as other:
        h = await _token(c, "led3@example.com")
        oh = await _token(other, "led4@example.com")
        pid = (await c.post("/portfolio", json={"name": "Imp"}, headers=h)).json()["id"]

        broken = await c.post(f"/portfolio/{pid}/transactions/import", headers=h,
                              json={"rows": rows + [{"trade_date": "nope", "type": "BUY"}], "dry_run": False})
        assert broken.json()["imported"] == 0 and broken.json()["errors"][0]["row"] == 5
        dry = (await c.post(f"/portfolio/{pid}/transactions/import", headers=h, json={"rows": rows, "dry_run": True})).json()
        assert dry == {"valid": 4, "errors": [], "warnings": [], "imported": 0}
        assert (await c.get(f"/portfolio/{pid}/transactions", headers=h)).json() == []

        done = (await c.post(f"/portfolio/{pid}/transactions/import", headers=h, json={"rows": rows, "dry_run": False})).json()
        assert done["imported"] == 4
        listed = (await c.get(f"/portfolio/{pid}/transactions", headers=h)).json()
        assert [t["type"] for t in listed] == ["DIVIDEND", "SELL", "BUY", "BUY"] and listed[0]["source"] == "csv"

        fifo = (await c.get(f"/portfolio/{pid}/ledger", headers=h)).json()
        assert fifo["realised"][0]["gain"] == pytest.approx(1500) and fifo["realised"][0]["term"] == "long"
        assert fifo["income"] == [{"year": int(_d(90)[:4]), "currency": "USD", "type": "DIVIDEND", "amount": 15.5}]
        await c.put(f"/portfolio/{pid}/ledger/settings", headers=h, json={"cost_basis_method": "hifo"})
        hifo = (await c.get(f"/portfolio/{pid}/ledger", headers=h)).json()
        assert hifo["realised"][0]["gain"] == pytest.approx(500) and hifo["realised"][0]["term"] == "short"
        assert await _holdings(pid) == {"AAA": (10.0, 100.0)}  # HIFO keeps the cheap lot

        assert (await other.get(f"/portfolio/{pid}/ledger", headers=oh)).status_code == 404
        assert (await other.post(f"/portfolio/{pid}/transactions", headers=oh, json=rows[0])).status_code == 404

        assert (await c.delete(f"/portfolio/{pid}/ledger", headers=h)).status_code == 204
        assert (await c.get(f"/portfolio/{pid}/transactions", headers=h)).json() == []
        assert await _holdings(pid) == {"AAA": (10.0, 100.0)}  # holdings stay as last derived
        ok = await c.post(f"/portfolio/{pid}/holdings", headers=h, json={"ticker": "ZZZ", "shares": 1, "avg_cost": 1})
        assert ok.status_code == 201  # editable again


async def test_performance_follows_trade_dates_with_money_weighted_return(fake_prices):  # noqa: F811
    async with _client() as c:
        h = await _token(c, "led5@example.com")
        pid = (await c.post("/portfolio", json={"name": "Perf"}, headers=h)).json()["id"]
        await c.post(f"/portfolio/{pid}/transactions/import", headers=h, json={"dry_run": False, "rows": [
            {"trade_date": _d(200), "type": "BUY", "symbol": "AAA", "quantity": 10, "price": 100},
            {"trade_date": _d(60), "type": "BUY", "symbol": "BBB", "quantity": 20, "price": 50},
        ]})
        body = (await c.get(f"/portfolio/{pid}/performance?range=1y", headers=h)).json()
    assert body["holdings_source"] == "ledger" and body["mode"] == "actual"
    first = date.fromisoformat(body["series"][0]["date"])
    assert 0 <= (first - (TODAY - timedelta(days=200))).days <= 4  # starts at the first trade, not an upload
    assert any("Transactions start" in w for w in body["warnings"])
    s = body["stats"]
    assert s["mwr_period"] is not None and s["mwr_annualised"] is None  # < 1 year
    assert "Money-weighted return" in body["methodology"]
    # The BBB purchase is a cash flow: the value jumps, the time-weighted index does not.
    series = body["series"]
    assert max(b["value"] / a["value"] for a, b in zip(series, series[1:])) > 1.2
    assert max(b["index"] / a["index"] for a, b in zip(series, series[1:])) < 1.01


async def test_without_later_flows_money_weighted_equals_time_weighted(fake_prices):  # noqa: F811
    async with _client() as c:
        h = await _token(c, "led6@example.com")
        pid = (await c.post("/portfolio", json={"name": "One"}, headers=h)).json()["id"]
        await c.post(f"/portfolio/{pid}/transactions", headers=h, json={
            "trade_date": _d(500), "type": "BUY", "symbol": "AAA", "quantity": 3, "price": 90})
        s = (await c.get(f"/portfolio/{pid}/performance?range=1y", headers=h)).json()["stats"]
    assert s["mwr_period"] == pytest.approx(s["total_return"], abs=1e-4)
    assert s["mwr_annualised"] is not None  # a full year of history
