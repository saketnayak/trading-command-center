"""Integration tests: price_bars store and GET /portfolio/{id}/performance.

yfinance is replaced by a deterministic fake, so nothing touches the network."""
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from main import app
from app.database import AsyncSessionLocal
from app.models.portfolio import PortfolioHolding, PortfolioSnapshot
from app.models.price_bar import PriceBar
from app.services import price_history_service
from app.services.auth import create_invite_token

TODAY = datetime.now(timezone.utc).date()

# Daily growth per symbol; prices are 100 * (1 + g) ** days_since_start.
GROWTH = {"AAA": 0.001, "BBB": -0.0005, "SPY": 0.0004, "QQQ": 0.0006}


@pytest.fixture
def fake_prices(monkeypatch):
    calls: list[str] = []

    async def _fake_download(symbol: str, start: date):
        calls.append(symbol)
        if symbol not in GROWTH:
            raise ValueError("unknown symbol")
        out, d, i = {}, start, 0
        while d <= TODAY:
            if d.weekday() < 5:
                out[d] = 100 * (1 + GROWTH[symbol]) ** i
                i += 1
            d += timedelta(days=1)
        return out

    monkeypatch.setattr(price_history_service, "_download_closes", _fake_download)
    monkeypatch.setattr(price_history_service, "RETRY_DELAYS_S", (0.0,))
    price_history_service._recent_failures.clear()
    return calls


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _token(client: AsyncClient, email: str) -> dict:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234", "name": "P"})
    if r.status_code != 200:  # not the first user: needs an invite
        token = create_invite_token(email)
        r = await client.post(
            "/auth/register", json={"email": email, "password": "pass1234", "name": "P", "invite_token": token}
        )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _portfolio(client: AsyncClient, headers: dict, snapshots: list[tuple[int, dict[str, float]]]) -> str:
    """snapshots: (days_ago, {ticker: shares})"""
    r = await client.post("/portfolio", json={"name": "Perf"}, headers=headers)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    async with AsyncSessionLocal() as db:
        for days_ago, holdings in snapshots:
            snap = PortfolioSnapshot(
                portfolio_id=pid,
                uploaded_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
                row_count=len(holdings),
            )
            db.add(snap)
            await db.flush()
            for ticker, shares in holdings.items():
                db.add(PortfolioHolding(snapshot_id=snap.id, ticker=ticker, shares=shares, avg_cost=100.0, currency="USD"))
        await db.commit()
    return pid


async def test_refresh_stores_and_reuses_fresh_history(fake_prices):
    async with AsyncSessionLocal() as db:
        failed = await price_history_service.refresh_symbols(db, ["AAA", "NOPE"])
        assert failed == {"NOPE"}
        count = (await db.execute(select(func.count()).select_from(PriceBar).where(PriceBar.symbol == "AAA"))).scalar_one()
        assert count > 1000  # ~5 years of weekdays

        await price_history_service.refresh_symbols(db, ["AAA"])
        assert fake_prices.count("AAA") == 1  # fresh rows are reused, not re-downloaded

        await price_history_service.refresh_symbols(db, ["AAA"], force=True)
        assert fake_prices.count("AAA") == 2
        again = (await db.execute(select(func.count()).select_from(PriceBar).where(PriceBar.symbol == "AAA"))).scalar_one()
        assert again == count  # a refresh replaces the window instead of appending


async def test_failed_download_is_retried_then_cooled_down(fake_prices, monkeypatch):
    attempts: list[str] = []

    async def _flaky(symbol, start):
        attempts.append(symbol)
        raise ValueError("Too Many Requests")

    monkeypatch.setattr(price_history_service, "_download_closes", _flaky)
    async with AsyncSessionLocal() as db:
        assert await price_history_service.refresh_symbols(db, ["FLAKY"]) == {"FLAKY"}
        assert attempts == ["FLAKY", "FLAKY"]  # first try + one retry (RETRY_DELAYS_S patched to one delay)

        # Within the cooldown a second request does not download again...
        assert await price_history_service.refresh_symbols(db, ["FLAKY"]) == {"FLAKY"}
        assert len(attempts) == 2
        # ...but the nightly forced refresh does.
        await price_history_service.refresh_symbols(db, ["FLAKY"], force=True)
        assert len(attempts) == 4


async def test_retry_recovers_from_a_transient_failure(fake_prices, monkeypatch):
    real = price_history_service._download_closes
    state = {"n": 0}

    async def _once_then_ok(symbol, start):
        state["n"] += 1
        if state["n"] == 1:
            raise ValueError("Too Many Requests")
        return await real(symbol, start)

    monkeypatch.setattr(price_history_service, "_download_closes", _once_then_ok)
    async with AsyncSessionLocal() as db:
        assert await price_history_service.refresh_symbols(db, ["AAA"]) == set()
        closes = await price_history_service.load_closes(db, ["AAA"], TODAY - timedelta(days=30), TODAY)
        assert closes["AAA"]


async def test_failed_refresh_keeps_previous_rows(fake_prices, monkeypatch):
    async with AsyncSessionLocal() as db:
        await price_history_service.refresh_symbols(db, ["AAA"])

        async def _boom(symbol, start):
            raise ValueError("yahoo is down")

        monkeypatch.setattr(price_history_service, "_download_closes", _boom)
        failed = await price_history_service.refresh_symbols(db, ["AAA"], force=True)
        assert failed == {"AAA"}
        closes = await price_history_service.load_closes(db, ["AAA"], TODAY - timedelta(days=30), TODAY)
        assert closes["AAA"]


async def test_current_mode_for_a_new_portfolio(fake_prices):
    async with _client() as client:
        headers = await _token(client, "perf@example.com")
        pid = await _portfolio(client, headers, [(1, {"AAA": 10, "BBB": 5})])
        r = await client.get(f"/portfolio/{pid}/performance?range=1y", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "current"  # 1 day of history < 30
    assert any("What-if" in w for w in body["warnings"])
    assert body["benchmark"] == "SPY"
    assert len(body["series"]) > 200
    assert body["series"][0]["index"] == 100
    assert body["stats"]["total_return"] > 0
    assert body["benchmark_stats"]["total_return"] > 0
    assert body["period_returns"]["1M"] is not None
    assert {h["ticker"] for h in body["holdings"]} == {"AAA", "BBB"}
    assert body["methodology"]


async def test_actual_mode_follows_snapshots_and_starts_at_first_upload(fake_prices):
    async with _client() as client:
        headers = await _token(client, "perf2@example.com")
        pid = await _portfolio(client, headers, [(90, {"AAA": 10}), (40, {"AAA": 10, "BBB": 50})])
        r = await client.get(f"/portfolio/{pid}/performance?range=1y&benchmark=qqq", headers=headers)
    body = r.json()
    assert body["mode"] == "actual"
    assert body["benchmark"] == "QQQ"
    assert body["history_days"] >= 89
    first = date.fromisoformat(body["series"][0]["date"])
    assert (TODAY - first).days <= 92
    assert any("Upload history starts" in w for w in body["warnings"])
    # The value jumps when BBB is added, but the index does not.
    s = body["series"]
    value_jump = max(b["value"] / a["value"] for a, b in zip(s, s[1:]))
    index_jump = max(b["index"] / a["index"] for a, b in zip(s, s[1:]))
    assert value_jump > 1.5
    assert index_jump < 1.01
    assert body["stats"]["total_return"] < 0.2


async def test_unknown_holding_and_benchmark_are_warned(fake_prices):
    async with _client() as client:
        headers = await _token(client, "perf3@example.com")
        pid = await _portfolio(client, headers, [(1, {"AAA": 1, "ZZZZ": 3})])
        r = await client.get(f"/portfolio/{pid}/performance?benchmark=NOPE", headers=headers)
    body = r.json()
    assert r.status_code == 200
    assert any("ZZZZ" in w for w in body["warnings"])
    assert any("benchmark NOPE" in w for w in body["warnings"])
    assert body["benchmark_stats"] is None


async def test_empty_portfolio_and_validation_and_ownership(fake_prices):
    async with _client() as client, _client() as other_client:
        headers = await _token(client, "perf4@example.com")
        other_headers = await _token(other_client, "perf5@example.com")
        r = await client.post("/portfolio", json={"name": "Empty"}, headers=headers)
        pid = r.json()["id"]
        empty = (await client.get(f"/portfolio/{pid}/performance", headers=headers)).json()
        assert empty["series"] == [] and empty["message"]

        bad = await client.get(f"/portfolio/{pid}/performance?benchmark=SP%20Y", headers=headers)
        assert bad.status_code == 422
        bad_range = await client.get(f"/portfolio/{pid}/performance?range=10y", headers=headers)
        assert bad_range.status_code == 422

        forbidden = await other_client.get(f"/portfolio/{pid}/performance", headers=other_headers)
        assert forbidden.status_code == 404
        unauth = await client.get(f"/portfolio/{pid}/performance")
        assert unauth.status_code in (401, 403)


async def test_tracked_symbols_cover_latest_snapshots_and_benchmarks(fake_prices):
    async with _client() as client:
        headers = await _token(client, "perf6@example.com")
        await _portfolio(client, headers, [(10, {"OLD": 1}), (1, {"AAA": 1})])
    async with AsyncSessionLocal() as db:
        symbols = await price_history_service.tracked_symbols(db)
    assert "AAA" in symbols and "SPY" in symbols and "QQQ" in symbols
    assert "OLD" not in symbols  # only the latest snapshot counts


async def test_failed_refresh_with_stored_rows_warns_stale_not_missing(fake_prices, monkeypatch):
    async with _client() as client:
        headers = await _token(client, "perf7@example.com")
        pid = await _portfolio(client, headers, [(1, {"AAA": 10})])
        first = (await client.get(f"/portfolio/{pid}/performance", headers=headers)).json()
        assert first["stats"]["total_return"] is not None

        # Make the stored AAA rows stale, then make every download fail.
        async with AsyncSessionLocal() as db:
            from sqlalchemy import update
            await db.execute(update(PriceBar).where(PriceBar.symbol == "AAA").values(fetched_at=datetime(2020, 1, 1, tzinfo=timezone.utc)))
            await db.commit()

        async def _boom(symbol, start):
            raise ValueError("Too Many Requests")

        monkeypatch.setattr(price_history_service, "_download_closes", _boom)
        body = (await client.get(f"/portfolio/{pid}/performance", headers=headers)).json()
    assert body["stats"]["total_return"] == first["stats"]["total_return"]
    assert not any("No price history for AAA" in w for w in body["warnings"])
    assert any("Could not refresh prices for AAA" in w for w in body["warnings"])
