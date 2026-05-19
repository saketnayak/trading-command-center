import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, func, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.base import Base


class PortfolioThesisCrossRef(Base):
    __tablename__ = "portfolio_thesis_crossrefs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    portfolio_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    llm_provider: Mapped[str] = mapped_column(String, nullable=False)
    llm_model: Mapped[str] = mapped_column(String, nullable=False)

    thesis_text: Mapped[str] = mapped_column(Text, nullable=False)
    thesis_text_preview: Mapped[str] = mapped_column(String(200), nullable=False)

    alignment_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    thesis_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    aligned_positions: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    misaligned_positions: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    missing_exposure: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    excess_exposure: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    recommendations: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    holdings_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
