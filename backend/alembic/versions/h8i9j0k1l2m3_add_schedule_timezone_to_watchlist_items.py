"""add schedule_timezone to watchlist_items

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-06-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "h8i9j0k1l2m3"
down_revision: Union[str, Sequence[str], None] = "g7h8i9j0k1l2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _watchlist_item_columns() -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns("watchlist_items")}


def upgrade() -> None:
    if "schedule_timezone" in _watchlist_item_columns():
        return
    op.add_column(
        "watchlist_items",
        sa.Column("schedule_timezone", sa.String(length=64), server_default="UTC", nullable=False),
    )


def downgrade() -> None:
    if "schedule_timezone" not in _watchlist_item_columns():
        return
    op.drop_column("watchlist_items", "schedule_timezone")
