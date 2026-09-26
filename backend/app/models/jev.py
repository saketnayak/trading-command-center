import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class JevSessionStatus(str, enum.Enum):
    running = "running"
    completed = "completed"
    stopped = "stopped"
    killed = "killed"
    failed = "failed"
    interrupted = "interrupted"


class JevSession(Base):
    __tablename__ = "jev_sessions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    symbol: Mapped[str] = mapped_column(String(32))
    mode: Mapped[str] = mapped_column(String(16))  # shadow | paper
    status: Mapped[JevSessionStatus] = mapped_column(SAEnum(JevSessionStatus), default=JevSessionStatus.running)
    force_mock: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    thresholds: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    limits: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    max_ticks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_duration_s: Mapped[int] = mapped_column(Integer)
    order_prefix: Mapped[str] = mapped_column(String(32))
    decision_route: Mapped[str | None] = mapped_column(String, nullable=True)
    decision_model: Mapped[str | None] = mapped_column(String, nullable=True)
    start_equity_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    tick_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    inventory: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    realised_pnl_usd: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    last_mid: Mapped[float | None] = mapped_column(Float, nullable=True)
    fills: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    orders_submitted: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    orders_rejected: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    stop_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JevTick(Base):
    __tablename__ = "jev_ticks"
    __table_args__ = (
        UniqueConstraint("session_id", "tick", name="uq_jev_ticks_session_tick"),
        Index("ix_jev_ticks_ts", "ts"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jev_sessions.id", ondelete="CASCADE"), index=True)
    tick: Mapped[int] = mapped_column(Integer)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    mid: Mapped[float | None] = mapped_column(Float, nullable=True)
    spread_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    action: Mapped[str] = mapped_column(String(32))
    action_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    rung: Mapped[str] = mapped_column(String(16))
    direction_leg: Mapped[str | None] = mapped_column(String(8), nullable=True)
    direction: Mapped[str | None] = mapped_column(String(16), nullable=True)
    direction_conf: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    route: Mapped[str | None] = mapped_column(String, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    jev_status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # answered|paced|rate_limited|late|error|mock
    jev_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    answer_age_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    inventory: Mapped[float] = mapped_column(Float, default=0.0)
    unrealised_pnl_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    realised_pnl_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    drawdown_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    fill: Mapped[str | None] = mapped_column(Text, nullable=True)
    orders: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    answers: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
