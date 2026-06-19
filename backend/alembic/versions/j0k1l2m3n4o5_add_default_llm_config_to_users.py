"""add default llm config to users

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa

revision = "j0k1l2m3n4o5"
down_revision = "i9j0k1l2m3n4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("default_llm_provider", sa.String(32), nullable=False, server_default="openai"),
    )
    op.add_column(
        "users",
        sa.Column("default_llm_model", sa.String(128), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("default_llm_depth", sa.String(16), nullable=False, server_default="standard"),
    )


def downgrade() -> None:
    op.drop_column("users", "default_llm_depth")
    op.drop_column("users", "default_llm_model")
    op.drop_column("users", "default_llm_provider")
