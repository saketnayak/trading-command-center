"""add kalman settings table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-10 07:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kalman_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("observation_covariance", sa.Float(), server_default="0.1", nullable=False),
        sa.Column("transition_covariance", sa.Float(), server_default="0.01", nullable=False),
        sa.Column("processing_mode", sa.String(length=16), server_default="causal", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO kalman_settings "
            "(id, observation_covariance, transition_covariance, processing_mode) "
            "VALUES (1, 0.1, 0.01, 'causal')"
        )
    )


def downgrade() -> None:
    op.drop_table("kalman_settings")
