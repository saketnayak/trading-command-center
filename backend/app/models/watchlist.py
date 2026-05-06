import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, func, UniqueConstraint, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Watchlist(Base):
    __tablename__ = "watchlists"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String, default="My Watchlist")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    items = relationship("WatchlistItem", back_populates="watchlist", cascade="all, delete-orphan")


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("watchlist_id", "ticker"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    watchlist_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("watchlists.id"))
    ticker: Mapped[str] = mapped_column(String(16))
    llm_provider: Mapped[str] = mapped_column(String)
    llm_model: Mapped[str] = mapped_column(String)
    depth: Mapped[str] = mapped_column(String, default="standard")
    analysts: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    schedule_cron: Mapped[str | None] = mapped_column(String, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    watchlist = relationship("Watchlist", back_populates="items")
