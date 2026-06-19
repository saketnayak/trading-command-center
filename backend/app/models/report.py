import uuid
from datetime import datetime
from sqlalchemy import String, Enum as SAEnum, DateTime, ForeignKey, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.base import Base
from app.models.run import RunVerdict

class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("run_id"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"))
    trader_decision: Mapped[str] = mapped_column(String)
    verdict: Mapped[RunVerdict] = mapped_column(SAEnum(RunVerdict))
    suggested_entry: Mapped[str | None] = mapped_column(String, nullable=True)
    suggested_stop: Mapped[str | None] = mapped_column(String, nullable=True)
    suggested_target: Mapped[str | None] = mapped_column(String, nullable=True)
    price_currency: Mapped[str] = mapped_column(String(8), server_default="USD")
    risk_assessment: Mapped[str] = mapped_column(String, default="")
    raw_report: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
