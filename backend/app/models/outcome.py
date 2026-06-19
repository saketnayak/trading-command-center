import uuid
from datetime import datetime
from sqlalchemy import String, Float, DateTime, ForeignKey, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.base import Base


class RunOutcome(Base):
    __tablename__ = "run_outcomes"
    __table_args__ = (UniqueConstraint("run_id"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    ticker: Mapped[str] = mapped_column(String(16))
    verdict: Mapped[str] = mapped_column(String)
    analysis_date: Mapped[str] = mapped_column(String)  # YYYY-MM-DD string
    price_at_analysis: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_7d: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_14d: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_30d: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_90d: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_currency: Mapped[str] = mapped_column(String(8), server_default="USD")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
