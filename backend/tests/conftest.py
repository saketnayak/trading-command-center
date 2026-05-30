import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import create_async_engine


_DEFAULT_DATABASE_URL = "postgresql://agentfloor:agentfloor@localhost:5433/agentfloor"
_BASE_DATABASE_URL = os.environ.get("DATABASE_URL", _DEFAULT_DATABASE_URL)
_TEST_DATABASE_NAME = f"{make_url(_BASE_DATABASE_URL).database}_test_{uuid.uuid4().hex}"


def _async_url(url: str | URL, database: str | None = None) -> URL:
    parsed = make_url(url)
    drivername = "postgresql+asyncpg" if parsed.drivername.startswith("postgresql") else parsed.drivername
    return parsed.set(drivername=drivername, database=database or parsed.database)


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


os.environ["DATABASE_URL"] = _async_url(_BASE_DATABASE_URL, _TEST_DATABASE_NAME).render_as_string(
    hide_password=False
)


async def _create_test_database() -> None:
    admin_url = _async_url(_BASE_DATABASE_URL, "postgres")
    admin_engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with admin_engine.connect() as conn:
        await conn.execute(text(f"CREATE DATABASE {_quote_identifier(_TEST_DATABASE_NAME)}"))
    await admin_engine.dispose()


async def _drop_test_database() -> None:
    admin_url = _async_url(_BASE_DATABASE_URL, "postgres")
    admin_engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with admin_engine.connect() as conn:
        await conn.execute(
            text(
                "SELECT pg_terminate_backend(pid) "
                "FROM pg_stat_activity "
                "WHERE datname = :database_name AND pid <> pg_backend_pid()"
            ),
            {"database_name": _TEST_DATABASE_NAME},
        )
        await conn.execute(text(f"DROP DATABASE IF EXISTS {_quote_identifier(_TEST_DATABASE_NAME)}"))
    await admin_engine.dispose()


@pytest.fixture(scope="session", autouse=True)
async def temporary_database():
    """Run database tests against an isolated database created for this test session."""
    await _create_test_database()

    try:
        # Import after DATABASE_URL is replaced so app.database binds to the temp database.
        import app.models.agent_event  # noqa: F401
        import app.models.api_key  # noqa: F401
        import app.models.investor_profile  # noqa: F401
        import app.models.outcome  # noqa: F401
        import app.models.portfolio  # noqa: F401
        import app.models.portfolio_delivery_settings  # noqa: F401
        import app.models.portfolio_insight  # noqa: F401
        import app.models.portfolio_thesis_crossref  # noqa: F401
        import app.models.report  # noqa: F401
        import app.models.run  # noqa: F401
        import app.models.user  # noqa: F401
        import app.models.watchlist  # noqa: F401
        from app.database import Base, engine

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        yield
    finally:
        if "engine" in locals():
            await engine.dispose()
        await _drop_test_database()


@pytest.fixture(autouse=True)
async def clean_db(request, temporary_database):
    """Truncate all tables before each test so each test starts with a clean slate."""
    # Skip for unit tests marked with @pytest.mark.unit
    if "unit" in request.keywords:
        yield
        return

    from app.database import engine

    async with engine.begin() as conn:
        await conn.execute(text(
            "TRUNCATE users, runs, agent_events, reports, api_keys, run_outcomes, "
            "watchlists, watchlist_items, portfolios, portfolio_snapshots, portfolio_holdings, "
            "investor_profiles, portfolio_thesis_crossrefs, portfolio_delivery_settings "
            "RESTART IDENTITY CASCADE"
        ))
    yield
