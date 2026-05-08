"""add preferred_currency to users

Revision ID: d1e2f3a4b5c6
Revises: b1c2d3e4f5a6
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa

revision = 'd1e2f3a4b5c6'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("preferred_currency", sa.String(8), nullable=False, server_default="USD"),
    )


def downgrade() -> None:
    op.drop_column("users", "preferred_currency")
