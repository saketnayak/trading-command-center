"""drop watchlist schedule timezone

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-06-16 07:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "i9j0k1l2m3n4"
down_revision: Union[str, Sequence[str], None] = "h8i9j0k1l2m3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _watchlist_item_columns() -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns("watchlist_items")}


def upgrade() -> None:
    if "schedule_timezone" not in _watchlist_item_columns():
        return
    op.drop_column("watchlist_items", "schedule_timezone")


def downgrade() -> None:
    if "schedule_timezone" in _watchlist_item_columns():
        return
    op.add_column(
        "watchlist_items",
        sa.Column("schedule_timezone", sa.String(length=64), server_default="UTC", nullable=False),
    )
