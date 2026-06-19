"""add price_currency to reports and run_outcomes

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa

revision = "k1l2m3n4o5p6"
down_revision = "j0k1l2m3n4o5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reports",
        sa.Column("price_currency", sa.String(length=8), nullable=False, server_default="USD"),
    )
    op.add_column(
        "run_outcomes",
        sa.Column("price_currency", sa.String(length=8), nullable=False, server_default="USD"),
    )


def downgrade() -> None:
    op.drop_column("run_outcomes", "price_currency")
    op.drop_column("reports", "price_currency")
