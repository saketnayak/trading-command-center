"""add finnhub capability fields to api_keys

Revision ID: g7h8i9j0k1l2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-13 18:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "g7h8i9j0k1l2"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("api_keys", sa.Column("capabilities", sa.JSON(), nullable=True))
    op.add_column("api_keys", sa.Column("last_error_code", sa.String(), nullable=True))
    op.add_column("api_keys", sa.Column("last_error_message", sa.String(), nullable=True))
    op.add_column(
        "api_keys",
        sa.Column("capabilities_checked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("api_keys", "capabilities_checked_at")
    op.drop_column("api_keys", "last_error_message")
    op.drop_column("api_keys", "last_error_code")
    op.drop_column("api_keys", "capabilities")
