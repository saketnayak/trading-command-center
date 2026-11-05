"""add learning loop: users.learning_* and run_reflections

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-11-05 15:00:00.000000

This first shipped as w3x4y5z6a7b8, the same ID as the stranded-snapshot cleanup
merged just before it, which left two heads. It now follows that cleanup. A
database that ran it under the old ID already has these columns and the table,
so upgrade() skips whatever exists.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "x4y5z6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "w3x4y5z6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    user_columns = {c["name"] for c in inspector.get_columns("users")}
    if "learning_enabled" not in user_columns:
        op.add_column("users", sa.Column("learning_enabled", sa.Boolean(), server_default="false", nullable=False))
    if "learning_horizon_days" not in user_columns:
        op.add_column("users", sa.Column("learning_horizon_days", sa.Integer(), server_default="30", nullable=False))
    if inspector.has_table("run_reflections"):
        return
    op.create_table(
        "run_reflections",
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("horizon_days", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("realised_return", sa.Float(), nullable=True),
        sa.Column("benchmark_return", sa.Float(), nullable=True),
        sa.Column("scores", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("run_id"),
    )
    op.create_index(op.f("ix_run_reflections_user_id"), "run_reflections", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_run_reflections_user_id"), table_name="run_reflections")
    op.drop_table("run_reflections")
    op.drop_column("users", "learning_horizon_days")
    op.drop_column("users", "learning_enabled")
