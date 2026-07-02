import os
import sys
from logging.config import fileConfig
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool
from alembic import context

# Add backend/ to sys.path so app.* imports work.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Import Base and all models for autogenerate — model files only depend on
# app.base (no config/settings import needed here).
from app.base import Base  # noqa: E402
from app.models import user, run, agent_event, report, api_key, outcome  # noqa: F401, E402
from app.models import portfolio, portfolio_insight, watchlist, investor_profile  # noqa: F401, E402
from app.models import portfolio_delivery_settings  # noqa: F401, E402
from app.models import ticker_metadata  # noqa: F401, E402
from app.models import settings  # noqa: F401, E402

_DEFAULT_DATABASE_URL = "postgresql://agentfloor:agentfloor@localhost:5433/agentfloor"
_PLACEHOLDER_INI_URL = "driver://user:pass@localhost/dbname"


def _load_env_files() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    load_dotenv(backend_dir / ".env")
    load_dotenv(backend_dir.parent / ".env")


def _normalize_database_url(url: str) -> str:
    return url.replace("+asyncpg", "")


def _resolve_database_url(config_ini_url: str) -> str:
    _load_env_files()

    env_url = os.getenv("DATABASE_URL", "").strip()
    if env_url:
        return _normalize_database_url(env_url)

    ini_url = config_ini_url.strip()
    if ini_url and ini_url != _PLACEHOLDER_INI_URL:
        return _normalize_database_url(ini_url)

    return _DEFAULT_DATABASE_URL


config = context.config

# DATABASE_URL can come from the environment (preferred), backend/.env, repo .env,
# alembic.ini, or the local docker-compose default on port 5433.
db_url = _resolve_database_url(config.get_main_option("sqlalchemy.url", ""))
config.set_main_option("sqlalchemy.url", db_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
