from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class DividendHistory(Base):
    """Per-share cash dividends by ex-dividend date (yfinance; split-adjusted).
    Written by dividend_service, which replaces a symbol's history on refresh."""

    __tablename__ = "dividend_history"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    ex_date: Mapped[date] = mapped_column(Date, primary_key=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)


class DividendSync(Base):
    """When a symbol's dividends were last fetched, so symbols that pay nothing
    (growth stocks, crypto) are not fetched again on every request."""

    __tablename__ = "dividend_sync"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payments: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
