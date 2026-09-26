"""add jev_sessions and jev_ticks

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-09-26 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "m3n4o5p6q7r8"
down_revision: Union[str, Sequence[str], None] = "l2m3n4o5p6q7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATUS = sa.Enum("running", "completed", "stopped", "killed", "failed", "interrupted", name="jevsessionstatus")


def upgrade() -> None:
    op.create_table(
        "jev_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("status", _STATUS, nullable=False),
        sa.Column("force_mock", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("thresholds", sa.JSON(), nullable=False),
        sa.Column("limits", sa.JSON(), nullable=False),
        sa.Column("max_ticks", sa.Integer(), nullable=True),
        sa.Column("max_duration_s", sa.Integer(), nullable=False),
        sa.Column("order_prefix", sa.String(32), nullable=False),
        sa.Column("decision_route", sa.String(), nullable=True),
        sa.Column("decision_model", sa.String(), nullable=True),
        sa.Column("start_equity_usd", sa.Float(), nullable=True),
        sa.Column("tick_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("inventory", sa.Float(), server_default="0", nullable=False),
        sa.Column("realised_pnl_usd", sa.Float(), server_default="0", nullable=False),
        sa.Column("last_mid", sa.Float(), nullable=True),
        sa.Column("fills", sa.Integer(), server_default="0", nullable=False),
        sa.Column("orders_submitted", sa.Integer(), server_default="0", nullable=False),
        sa.Column("orders_rejected", sa.Integer(), server_default="0", nullable=False),
        sa.Column("cost_usd", sa.Float(), server_default="0", nullable=False),
        sa.Column("stop_reason", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "jev_ticks",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("jev_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tick", sa.Integer(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("mid", sa.Float(), nullable=True),
        sa.Column("spread_bps", sa.Float(), nullable=True),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("action_reason", sa.Text(), nullable=True),
        sa.Column("rung", sa.String(16), nullable=False),
        sa.Column("direction_leg", sa.String(8), nullable=True),
        sa.Column("direction", sa.String(16), nullable=True),
        sa.Column("direction_conf", sa.Float(), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("route", sa.String(), nullable=True),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("inventory", sa.Float(), nullable=False),
        sa.Column("unrealised_pnl_usd", sa.Float(), nullable=True),
        sa.Column("realised_pnl_usd", sa.Float(), nullable=True),
        sa.Column("drawdown_pct", sa.Float(), nullable=True),
        sa.Column("fill", sa.Text(), nullable=True),
        sa.Column("orders", sa.JSON(), nullable=False),
        sa.Column("answers", sa.JSON(), nullable=True),
        sa.Column("snapshot", sa.JSON(), nullable=True),
        sa.UniqueConstraint("session_id", "tick", name="uq_jev_ticks_session_tick"),
    )
    op.create_index("ix_jev_ticks_session_id", "jev_ticks", ["session_id"])
    op.create_index("ix_jev_ticks_ts", "jev_ticks", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_jev_ticks_ts", table_name="jev_ticks")
    op.drop_index("ix_jev_ticks_session_id", table_name="jev_ticks")
    op.drop_table("jev_ticks")
    op.drop_table("jev_sessions")
    _STATUS.drop(op.get_bind(), checkfirst=True)
