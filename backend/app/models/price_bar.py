from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class PriceBar(Base):
    """One daily close per symbol, adjusted for splits and dividends.

    Written by price_history_service, which always replaces a symbol's whole
    window at once: adjusted closes are rewritten upstream after every
    dividend or split, so mixing an old fetch with a new one would create
    fake jumps in the return series.
    """

    __tablename__ = "price_bars"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
