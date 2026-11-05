"""add fund_profiles for ETF look-through

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-11-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fund_profiles",
        sa.Column("ticker", sa.String(length=32), primary_key=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=True),
        sa.Column("sector", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=True),
        sa.Column("as_of", sa.Date(), nullable=True),
        sa.Column("holdings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("sectors", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("covered_weight", sa.Float(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("fund_profiles")
