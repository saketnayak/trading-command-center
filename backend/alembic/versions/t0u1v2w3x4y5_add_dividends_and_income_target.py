"""add dividend_history, dividend_sync and portfolios.income_target_monthly

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-11-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "t0u1v2w3x4y5"
down_revision: Union[str, Sequence[str], None] = "s9t0u1v2w3x4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dividend_history",
        sa.Column("symbol", sa.String(32), primary_key=True),
        sa.Column("ex_date", sa.Date(), primary_key=True),
        sa.Column("amount", sa.Float(), nullable=False),
    )
    op.create_table(
        "dividend_sync",
        sa.Column("symbol", sa.String(32), primary_key=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payments", sa.Integer(), nullable=False),
    )
    op.add_column("portfolios", sa.Column("income_target_monthly", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("portfolios", "income_target_monthly")
    op.drop_table("dividend_sync")
    op.drop_table("dividend_history")
