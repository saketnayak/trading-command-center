import pytest
from pathlib import Path
from unittest.mock import AsyncMock
from httpx import AsyncClient, ASGITransport
from main import app
from app.services.auth import create_invite_token

FIXTURES_DIR = Path(__file__).parent / "fixtures"


async def _register_and_login(client: AsyncClient, email: str, password: str = "password123") -> str:
    r = await client.post("/auth/register", json={"email": email, "password": password, "name": "Test User"})
    assert r.status_code == 200, r.text
    r2 = await client.post("/auth/login", json={"email": email, "password": password})
    assert r2.status_code == 200, r2.text
    return r2.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _create_portfolio(client: AsyncClient, token: str, name: str = "Test Portfolio") -> str:
    r = await client.post("/portfolio", json={"name": name}, headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_portfolio_crud():
    """Create, list, delete portfolio — after delete list is empty."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "crud@example.com")

        # Create
        portfolio_id = await _create_portfolio(client, token)

        # List — should contain 1
        r = await client.get("/portfolio", headers=_auth(token))
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 1
        assert items[0]["id"] == portfolio_id
        assert items[0]["name"] == "Test Portfolio"

        # Delete
        r = await client.delete(f"/portfolio/{portfolio_id}", headers=_auth(token))
        assert r.status_code == 204

        # List — should be empty
        r = await client.get("/portfolio", headers=_auth(token))
        assert r.status_code == 200
        assert r.json() == []


@pytest.mark.asyncio
async def test_upload_moomoo_csv():
    """Upload moomoo CSV; assert broker, row_count, and expected tickers."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "moomoo@example.com")
        portfolio_id = await _create_portfolio(client, token)

        with open(FIXTURES_DIR / "moomoo_positions.csv", "rb") as f:
            r = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("moomoo.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["broker"] == "moomoo"
        # $USD row is skipped; 2 equity rows
        assert data["row_count"] == 2

        # Verify holdings contain expected tickers
        r2 = await client.get(f"/portfolio/{portfolio_id}/current", headers=_auth(token))
        assert r2.status_code == 200
        tickers = {h["ticker"] for h in r2.json()["holdings"]}
        assert "AAPL" in tickers
        assert "NVDA" in tickers
        assert "$USD" not in tickers


@pytest.mark.asyncio
async def test_upload_fidelity_csv():
    """Upload fidelity CSV; assert broker and row_count."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "fidelity@example.com")
        portfolio_id = await _create_portfolio(client, token)

        with open(FIXTURES_DIR / "fidelity_positions.csv", "rb") as f:
            r = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("fidelity.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["broker"] == "fidelity"
        assert data["row_count"] == 2

        r2 = await client.get(f"/portfolio/{portfolio_id}/current", headers=_auth(token))
        assert r2.status_code == 200
        tickers = {h["ticker"] for h in r2.json()["holdings"]}
        assert "AAPL" in tickers
        assert "MSFT" in tickers


@pytest.mark.asyncio
async def test_upload_schwab_csv():
    """Upload schwab CSV; assert broker and row_count."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "schwab@example.com")
        portfolio_id = await _create_portfolio(client, token)

        with open(FIXTURES_DIR / "schwab_positions.csv", "rb") as f:
            r = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("schwab.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["broker"] == "schwab"
        assert data["row_count"] == 2

        r2 = await client.get(f"/portfolio/{portfolio_id}/current", headers=_auth(token))
        assert r2.status_code == 200
        tickers = {h["ticker"] for h in r2.json()["holdings"]}
        assert "AAPL" in tickers
        assert "TSLA" in tickers


@pytest.mark.asyncio
async def test_upload_generic_csv():
    """Upload generic CSV; assert broker and row_count."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "generic@example.com")
        portfolio_id = await _create_portfolio(client, token)

        with open(FIXTURES_DIR / "generic_positions.csv", "rb") as f:
            r = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("generic.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["broker"] == "generic"
        assert data["row_count"] == 3

        r2 = await client.get(f"/portfolio/{portfolio_id}/current", headers=_auth(token))
        assert r2.status_code == 200
        tickers = {h["ticker"] for h in r2.json()["holdings"]}
        assert "AAPL" in tickers
        assert "NVDA" in tickers
        assert "TSLA" in tickers


@pytest.mark.asyncio
async def test_two_sequential_uploads_two_snapshots():
    """Upload twice; GET /snapshots returns 2; GET /current returns holdings from second upload."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "twouploads@example.com")
        portfolio_id = await _create_portfolio(client, token)

        # First upload: moomoo (AAPL, NVDA)
        with open(FIXTURES_DIR / "moomoo_positions.csv", "rb") as f:
            r = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("moomoo.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r.status_code == 200

        # Second upload: fidelity (AAPL, MSFT)
        with open(FIXTURES_DIR / "fidelity_positions.csv", "rb") as f:
            r = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("fidelity.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r.status_code == 200

        # List snapshots — should be 2
        r_snaps = await client.get(f"/portfolio/{portfolio_id}/snapshots", headers=_auth(token))
        assert r_snaps.status_code == 200
        snapshots = r_snaps.json()
        assert len(snapshots) == 2

        # Current holdings should reflect second upload (fidelity: AAPL, MSFT)
        r_curr = await client.get(f"/portfolio/{portfolio_id}/current", headers=_auth(token))
        assert r_curr.status_code == 200
        tickers = {h["ticker"] for h in r_curr.json()["holdings"]}
        assert "AAPL" in tickers
        assert "MSFT" in tickers
        assert "NVDA" not in tickers


@pytest.mark.asyncio
async def test_snapshot_delete_rolls_back_to_previous():
    """Upload twice, delete latest snapshot; GET /current returns holdings from first upload."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "rollback@example.com")
        portfolio_id = await _create_portfolio(client, token)

        # First upload: moomoo (AAPL, NVDA)
        with open(FIXTURES_DIR / "moomoo_positions.csv", "rb") as f:
            r1 = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("moomoo.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r1.status_code == 200

        # Second upload: fidelity (AAPL, MSFT)
        with open(FIXTURES_DIR / "fidelity_positions.csv", "rb") as f:
            r2 = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("fidelity.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r2.status_code == 200

        # Get snapshots — ordered desc by uploaded_at; first in list is latest
        r_snaps = await client.get(f"/portfolio/{portfolio_id}/snapshots", headers=_auth(token))
        assert r_snaps.status_code == 200
        snapshots = r_snaps.json()
        assert len(snapshots) == 2
        assert snapshots[0]["uploaded_at"] >= snapshots[1]["uploaded_at"]
        latest_snap_id = snapshots[0]["id"]

        # Delete the latest snapshot
        r_del = await client.delete(
            f"/portfolio/{portfolio_id}/snapshots/{latest_snap_id}",
            headers=_auth(token),
        )
        assert r_del.status_code == 204

        # Current holdings should now reflect first upload (moomoo: AAPL, NVDA)
        r_curr = await client.get(f"/portfolio/{portfolio_id}/current", headers=_auth(token))
        assert r_curr.status_code == 200
        tickers = {h["ticker"] for h in r_curr.json()["holdings"]}
        assert "AAPL" in tickers
        assert "NVDA" in tickers
        assert "MSFT" not in tickers


@pytest.mark.asyncio
async def test_get_current_no_finnhub_key(monkeypatch):
    """Without Finnhub key, stock prices fall back to Yahoo Finance and the response still signals delayed data."""
    from app.routers import portfolio as portfolio_router

    portfolio_router._price_cache.clear()
    fallback_prices = {"AAPL": 199.5, "NVDA": 410.0, "TSLA": 220.0}
    monkeypatch.setattr(
        portfolio_router._yf,
        "fetch_price",
        AsyncMock(side_effect=lambda ticker: fallback_prices.get(ticker)),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "nofinnhubkey@example.com")
        portfolio_id = await _create_portfolio(client, token)

        with open(FIXTURES_DIR / "generic_positions.csv", "rb") as f:
            r = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("generic.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r.status_code == 200

        r_curr = await client.get(f"/portfolio/{portfolio_id}/current", headers=_auth(token))
        assert r_curr.status_code == 200
        body = r_curr.json()
        assert body["price_unavailable_reason"] == "no_finnhub_key"
        prices_by_ticker = {h["ticker"]: h["current_price"] for h in body["holdings"]}
        assert prices_by_ticker == fallback_prices


@pytest.mark.asyncio
async def test_export_csv():
    """GET /export after upload returns text/csv with attachment disposition and matching row count."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _register_and_login(client, "export@example.com")
        portfolio_id = await _create_portfolio(client, token)

        # Upload generic (3 holdings: AAPL, NVDA, TSLA)
        with open(FIXTURES_DIR / "generic_positions.csv", "rb") as f:
            r = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("generic.csv", f, "text/csv")},
                headers=_auth(token),
            )
        assert r.status_code == 200

        r_exp = await client.get(f"/portfolio/{portfolio_id}/export", headers=_auth(token))
        assert r_exp.status_code == 200
        assert "text/csv" in r_exp.headers.get("content-type", "")
        content_disp = r_exp.headers.get("content-disposition", "")
        assert "attachment" in content_disp

        # Parse exported CSV; header row + 3 data rows
        lines = [line for line in r_exp.text.splitlines() if line.strip()]
        # lines[0] is header; remaining are data rows
        assert len(lines) == 1 + 3  # header + 3 holdings


@pytest.mark.asyncio
async def test_authorization_other_user_cannot_access():
    """User B cannot access a portfolio created by user A (returns 404)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token_a = await _register_and_login(client, "usera@example.com")
        # Generate invite token directly (avoids SMTP dependency in tests)
        invite_token = create_invite_token("userb@example.com")

        r_b = await client.post("/auth/register", json={
            "email": "userb@example.com",
            "password": "password123",
            "name": "User B",
            "invite_token": invite_token,
        })
        assert r_b.status_code == 200, r_b.text
        r_b_login = await client.post("/auth/login", json={"email": "userb@example.com", "password": "password123"})
        assert r_b_login.status_code == 200, r_b_login.text
        token_b = r_b_login.json()["access_token"]

        # User A creates a portfolio
        portfolio_id = await _create_portfolio(client, token_a)

        # Upload something so /current has data
        with open(FIXTURES_DIR / "generic_positions.csv", "rb") as f:
            r = await client.post(
                f"/portfolio/{portfolio_id}/upload",
                files={"file": ("generic.csv", f, "text/csv")},
                headers=_auth(token_a),
            )
        assert r.status_code == 200

        # User B tries to access user A's portfolio — should get 404
        r_curr = await client.get(f"/portfolio/{portfolio_id}/current", headers=_auth(token_b))
        assert r_curr.status_code == 404
