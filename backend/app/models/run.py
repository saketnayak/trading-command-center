import uuid, enum
from datetime import datetime, date
from sqlalchemy import String, Enum as SAEnum, DateTime, Date, ARRAY, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

class RunStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    aborted = "aborted"
    failed = "failed"

class RunVerdict(str, enum.Enum):
    buy = "buy"
    sell = "sell"
    hold = "hold"

class Run(Base):
    __tablename__ = "runs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    ticker: Mapped[str] = mapped_column(String(16))
    analysis_date: Mapped[date] = mapped_column(Date)
    llm_provider: Mapped[str] = mapped_column(String)
    llm_model: Mapped[str] = mapped_column(String)
    depth: Mapped[str] = mapped_column(String)  # quick|standard|deep
    analysts: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[RunStatus] = mapped_column(SAEnum(RunStatus), default=RunStatus.pending)
    archived: Mapped[bool] = mapped_column(default=False)
    verdict: Mapped[RunVerdict | None] = mapped_column(SAEnum(RunVerdict), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    report = relationship("Report", uselist=False, lazy="noload")
