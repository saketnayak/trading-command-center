import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, func, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.base import Base


class InvestorProfile(Base):
    __tablename__ = "investor_profiles"
    __table_args__ = (UniqueConstraint("user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    # Section 1 — Operating Base
    income_range: Mapped[str | None] = mapped_column(String(32), nullable=True)
    liquidity_reserve: Mapped[str | None] = mapped_column(Text, nullable=True)
    dependents: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Section 2 — Capital Base
    time_horizon: Mapped[str | None] = mapped_column(String(16), nullable=True)
    risk_willingness: Mapped[int | None] = mapped_column(Integer, nullable=True)
    risk_ability: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Section 3 — Investment Philosophy
    investment_style: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sizing_approach: Mapped[str | None] = mapped_column(String(24), nullable=True)
    preferred_sectors: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # Section 4 — Behavioral Profile
    blind_spots: Mapped[str | None] = mapped_column(Text, nullable=True)
    emotional_tendencies: Mapped[str | None] = mapped_column(Text, nullable=True)
    personal_rules: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Section 5 — Constraints and Goals
    anti_portfolio: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    target_portfolio_size: Mapped[str | None] = mapped_column(String(16), nullable=True)
    income_goal: Mapped[str | None] = mapped_column(String(16), nullable=True)
    milestones: Mapped[str | None] = mapped_column(Text, nullable=True)

    user = relationship("User", back_populates="investor_profile")
