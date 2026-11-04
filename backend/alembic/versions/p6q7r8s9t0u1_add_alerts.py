"""add alert_rules and alert_events

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-11-04 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "p6q7r8s9t0u1"
down_revision: Union[str, Sequence[str], None] = "o5p6q7r8s9t0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "alert_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("portfolio_id", sa.Uuid(), sa.ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=True),
        sa.Column("ticker", sa.String(32), nullable=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("channels", postgresql.JSONB(), nullable=False),
        sa.Column("cooldown_hours", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("state", postgresql.JSONB(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_alert_rules_user_id", "alert_rules", ["user_id"])
    op.create_table(
        "alert_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("alert_rules.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("ticker", sa.String(32), nullable=True),
        sa.Column("portfolio_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=True),
        sa.Column("delivery", postgresql.JSONB(), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_alert_events_user_id", "alert_events", ["user_id"])
    op.create_index("ix_alert_events_triggered_at", "alert_events", ["triggered_at"])


def downgrade() -> None:
    op.drop_table("alert_events")
    op.drop_table("alert_rules")
