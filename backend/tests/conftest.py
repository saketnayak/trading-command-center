import pytest
from sqlalchemy import text
from app.database import engine


@pytest.fixture(scope="session", autouse=True)
async def clean_db():
    """Truncate all tables before the test session so runs are idempotent."""
    async with engine.begin() as conn:
        await conn.execute(text(
            "TRUNCATE users, runs, agent_events, reports, api_keys RESTART IDENTITY CASCADE"
        ))
    yield
