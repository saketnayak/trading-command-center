import pytest
from sqlalchemy import text
from app.database import engine


@pytest.fixture(autouse=True)
async def clean_db():
    """Truncate all tables before each test so each test starts with a clean slate."""
    async with engine.begin() as conn:
        await conn.execute(text(
            "TRUNCATE users, runs, agent_events, reports, api_keys, run_outcomes, watchlists, watchlist_items RESTART IDENTITY CASCADE"
        ))
    yield
