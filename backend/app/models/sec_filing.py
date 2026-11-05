"""SEC EDGAR filings for held tickers (roadmap 3.3). Shared across users: a
filing and its digest are the same for everyone who holds the stock."""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class SecCik(Base):
    """Ticker → SEC CIK from EDGAR's company_tickers.json, refreshed weekly."""

    __tablename__ = "sec_ciks"

    ticker: Mapped[str] = mapped_column(String(32), primary_key=True)
    cik: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SecFiling(Base):
    """One 10-K, 10-Q, 8-K or Form 4. `diff` holds the risk-factor comparison with the
    previous filing of the same form (10-K/10-Q); `digest` the cited LLM summary."""

    __tablename__ = "sec_filings"

    accession: Mapped[str] = mapped_column(String(25), primary_key=True)
    cik: Mapped[int] = mapped_column(Integer, nullable=False)
    ticker: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    form: Mapped[str] = mapped_column(String(10), nullable=False)
    filed_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    primary_doc: Mapped[str] = mapped_column(String(256), nullable=False)
    items: Mapped[list] = mapped_column(JSONB, default=list)
    prev_accession: Mapped[str | None] = mapped_column(String(25), nullable=True)
    diff: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)  # deterministic, no model
    # pending → prepared → done | uncited | no_llm | failed; Form 4: not_applicable
    digest_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    digest: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    digest_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    digest_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    digest_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SecFilingText(Base):
    """Extracted text kept so the next filing can be compared without re-downloading:
    section "risk_factors" (paragraphs) for 10-K/10-Q, "document" for 8-K."""

    __tablename__ = "sec_filing_texts"

    accession: Mapped[str] = mapped_column(String(25), primary_key=True)
    section: Mapped[str] = mapped_column(String(32), primary_key=True)
    paragraphs: Mapped[list] = mapped_column(JSONB, nullable=False)


class SecInsiderTrade(Base):
    """A non-derivative transaction from a Form 4."""

    __tablename__ = "sec_insider_trades"

    accession: Mapped[str] = mapped_column(String(25), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticker: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    owner: Mapped[str | None] = mapped_column(String(256), nullable=True)
    role: Mapped[str | None] = mapped_column(String(256), nullable=True)
    trade_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    code: Mapped[str] = mapped_column(String(4), nullable=False)
    shares: Mapped[float] = mapped_column(Float, nullable=False)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    acquired: Mapped[bool] = mapped_column(Boolean, nullable=False)
    post_shares: Mapped[float | None] = mapped_column(Float, nullable=True)
    direct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    planned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class SecSync(Base):
    """When a ticker's filing list was last fetched (fresh for 6 h)."""

    __tablename__ = "sec_sync"

    ticker: Mapped[str] = mapped_column(String(32), primary_key=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
