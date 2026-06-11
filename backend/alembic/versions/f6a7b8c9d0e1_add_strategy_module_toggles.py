"""rename settings table and add strategy toggles

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-10 18:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.rename_table("kalman_settings", "settings")
    op.add_column("settings", sa.Column("enable_kalman_filter", sa.Boolean(), server_default="true", nullable=False))
    op.add_column("settings", sa.Column("enable_elliott_wave", sa.Boolean(), server_default="true", nullable=False))
    op.add_column("settings", sa.Column("enable_markov_regime", sa.Boolean(), server_default="true", nullable=False))


def downgrade() -> None:
    op.drop_column("settings", "enable_markov_regime")
    op.drop_column("settings", "enable_elliott_wave")
    op.drop_column("settings", "enable_kalman_filter")
    op.rename_table("settings", "kalman_settings")
