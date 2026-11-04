"""add portfolio_targets

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-11-04 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "q7r8s9t0u1v2"
down_revision: Union[str, Sequence[str], None] = "p6q7r8s9t0u1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "portfolio_targets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("portfolio_id", sa.Uuid(), sa.ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticker", sa.String(32), nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column("band", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("portfolio_id", "ticker", name="uq_portfolio_targets_ticker"),
    )
    op.create_index("ix_portfolio_targets_portfolio_id", "portfolio_targets", ["portfolio_id"])


def downgrade() -> None:
    op.drop_table("portfolio_targets")
