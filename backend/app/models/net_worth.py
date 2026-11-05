import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class NetWorthItem(Base):
    """Something a user owns or owes outside their portfolios: cash, property,
    private holdings, a loan, or a crypto wallet tracked by public address.

    Values live in NetWorthValuation rows, so the net-worth chart can follow
    them over time. For a wallet (`wallet_chain` set) a valuation holds the
    coin balance, which is priced at report time."""

    __tablename__ = "net_worth_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # asset | liability
    category: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    wallet_chain: Mapped[str | None] = mapped_column(String(8), nullable=True)  # btc | eth
    wallet_address: Mapped[str | None] = mapped_column(String(128), nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class NetWorthValuation(Base):
    """An item's value on a date (money in the item's currency; coins for a wallet).
    The latest valuation on or before a date is the item's value that day."""

    __tablename__ = "net_worth_valuations"

    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("net_worth_items.id", ondelete="CASCADE"), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    value: Mapped[float] = mapped_column(Float, nullable=False)
