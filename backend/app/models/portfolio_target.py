import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class PortfolioTarget(Base):
    """Target weight (0..1) and tolerance band (absolute, e.g. 0.05 = ±5pp) for one
    ticker in a portfolio. A portfolio's targets sum to 1 (enforced by the API)."""

    __tablename__ = "portfolio_targets"
    __table_args__ = (UniqueConstraint("portfolio_id", "ticker", name="uq_portfolio_targets_ticker"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    portfolio_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    ticker: Mapped[str] = mapped_column(String(32))
    weight: Mapped[float] = mapped_column(Float)
    band: Mapped[float] = mapped_column(Float, default=0.05)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
