import pytest
from sqlalchemy import text
from app.database import engine


@pytest.fixture(autouse=True)
async def clean_db(request):
    """Truncate all tables before each test so each test starts with a clean slate."""
    # Skip for unit tests marked with @pytest.mark.unit
    if "unit" in request.keywords:
        yield
        return

    async with engine.begin() as conn:
        await conn.execute(text(
            "TRUNCATE users, runs, agent_events, reports, api_keys, run_outcomes, "
            "watchlists, watchlist_items, portfolios, portfolio_snapshots, portfolio_holdings, "
            "investor_profiles, portfolio_thesis_crossrefs RESTART IDENTITY CASCADE"
        ))
    yield
