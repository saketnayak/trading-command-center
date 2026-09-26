"""add Jev decision status to jev_ticks

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-09-26 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "n4o5p6q7r8s9"
down_revision: Union[str, Sequence[str], None] = "m3n4o5p6q7r8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jev_ticks", sa.Column("jev_status", sa.String(16), nullable=True))
    op.add_column("jev_ticks", sa.Column("jev_provider", sa.String(), nullable=True))
    op.add_column("jev_ticks", sa.Column("answer_age_s", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("jev_ticks", "answer_age_s")
    op.drop_column("jev_ticks", "jev_provider")
    op.drop_column("jev_ticks", "jev_status")
