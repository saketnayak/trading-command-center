import os
import sys
from logging.config import fileConfig
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

config = context.config

# DATABASE_URL can come from the environment (preferred) or alembic.ini.
# Using the environment means `alembic revision --autogenerate` works locally
# with just `DATABASE_URL=... alembic ...` — no other secrets required.
db_url = os.getenv("DATABASE_URL") or config.get_main_option("sqlalchemy.url", "")
# Strip async driver prefix so the sync engine used by alembic works.
db_url = db_url.replace("+asyncpg", "")
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
