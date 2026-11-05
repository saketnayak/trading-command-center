"""What a held ticker is, for ETF look-through (roadmap 3.4). Shared across users:
a fund's holdings are the same for everyone who owns it."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class FundProfile(Base):
    """kind is fund, stock or unknown. For a fund, `holdings` lists {key, ticker, name, weight} (weight as a
    fraction of the fund), `sectors` maps Yahoo's sector keys to weights, and `covered_weight` is how much of
    the fund `holdings` accounts for. `fetched_at` is the last success; a failed refresh keeps the last good
    data and sets `error`."""

    __tablename__ = "fund_profiles"

    ticker: Mapped[str] = mapped_column(String(32), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)  # sec_nport | yahoo_top10
    as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    holdings: Mapped[list] = mapped_column(JSONB, default=list)
    sectors: Mapped[dict] = mapped_column(JSONB, default=dict)
    covered_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
