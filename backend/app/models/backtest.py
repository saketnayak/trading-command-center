import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class Backtest(Base):
    """A TradingAgents backtest: the agents re-run on past dates and scored on
    what the price did next (tradingagents.backtest.Backtester).

    `config` holds the request (tickers, dates, frequency, horizon, provider,
    model, depth, analysts, budget, dry_run). `trades` holds one row per
    (ticker, decision date) as they finish; `report` holds the summary,
    split into out-of-sample and in-sample decisions by the model's training
    cutoff. Status: pending → running → completed | stopped | failed | aborted |
    interrupted ("stopped" means the budget cap ended it early)."""

    __tablename__ = "backtests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    total_decisions: Mapped[int] = mapped_column(Integer, default=0)
    trades: Mapped[list] = mapped_column(JSONB, default=list)
    report: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
