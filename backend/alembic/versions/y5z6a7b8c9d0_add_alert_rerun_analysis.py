"""add alert_rules.rerun_analysis (re-run the analysis when a rule fires)

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-11-05 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "y5z6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "x4y5z6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("alert_rules", sa.Column("rerun_analysis", sa.Boolean(), server_default="false", nullable=False))


def downgrade() -> None:
    op.drop_column("alert_rules", "rerun_analysis")
