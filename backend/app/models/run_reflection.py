import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class RunReflection(Base):
    """One learning-loop reflection on a completed run: the agents compared their
    call with what the price did over `horizon_days` and wrote lessons into the
    run owner's memories. status: done | failed | skipped (no usable state or
    prices). One row per run; a failed one is retried up to MAX_ATTEMPTS times."""

    __tablename__ = "run_reflections"

    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16))
    horizon_days: Mapped[int] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    realised_return: Mapped[float | None] = mapped_column(Float, nullable=True)
    benchmark_return: Mapped[float | None] = mapped_column(Float, nullable=True)
    scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
