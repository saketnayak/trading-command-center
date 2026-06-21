import asyncio
import csv
import weakref
import io
import time
from uuid import UUID
from datetime import datetime, timezone, date, timedelta
from typing import Optional
from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload
import httpx

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import Portfolio, PortfolioSnapshot, PortfolioHolding
from app.models.portfolio_insight import PortfolioInsight, InsightStatus, InsightTrigger, InsightStance
from app.models.user import User
from app.models.run import Run, RunStatus
from app.models.report import Report
from app.models.api_key import ApiKey
from app.services.encryption import decrypt_key
from app.services.finnhub_client import (
    FinnhubCapability,
    FinnhubError,
    aggregate_unavailable_reason,
    fetch_json,
    get_finnhub_key,
    should_cache_error,
)
from app.services.portfolio_parser import parse_portfolio_csv
from app.services.ticker_metadata_service import get_many_ticker_metadata
from app.services.trim_signal_service import score_trim_signal
from app.services.markov_service import get_regime_for_portfolio
from app.services.settings_service import get_app_settings
from app.schemas.portfolio_delivery_settings import UpdateDeliverySettingsRequest
from app.utils.asset_type import is_crypto
from app.utils.quote_currency import quote_currency_from_ticker
from app.utils.response_language import DEFAULT_RESPONSE_LANGUAGE, normalize_response_language
from app.schemas.money import PriceQuote
from app.services.fx_service import SUPPORTED_CURRENCIES
from app.utils.llm_providers import (
    DEFAULT_LLM_DEPTH,
    LOCAL_LLM_PROVIDERS,
    normalize_llm_depth,
    normalize_llm_provider,
    resolve_llm_model,
)
import app.services.crypto_data_service as _crypto
import app.services.yfinance_service as _yf

router = APIRouter()

# In-process price cache: ticker → (PriceQuote, expiry_unix_ts)
_price_cache: dict[str, tuple[Optional[PriceQuote], float]] = {}
_CACHE_TTL = 3600  # 1 hour
# Lazily initialized per event loop to avoid loop-mismatch errors in multi-loop
# environments (e.g. pytest-asyncio with function-scoped loops).
_finnhub_semaphores: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _get_finnhub_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    if loop not in _finnhub_semaphores:
        _finnhub_semaphores[loop] = asyncio.Semaphore(5)
    return _finnhub_semaphores[loop]


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str


class PortfolioSnapshotResponse(BaseModel):
    id: UUID
    portfolio_id: UUID
    uploaded_at: datetime
    broker: Optional[str]
    row_count: int
    model_config = ConfigDict(from_attributes=True)


class PortfolioListItem(BaseModel):
    id: UUID
    name: str
    created_at: datetime
    last_snapshot_at: Optional[datetime]
    holding_count: int
    model_config = ConfigDict(from_attributes=True)


class LastRun(BaseModel):
    run_id: UUID
    verdict: str
    analysis_date: str
    suggested_entry: Optional[str] = None
    suggested_stop: Optional[str] = None
    suggested_target: Optional[str] = None
    previous_run_id: Optional[UUID] = None
    previous_verdict: Optional[str] = None
    previous_analysis_date: Optional[str] = None


class TrimSignalEntry(BaseModel):
    holding_id: UUID
    ticker: str
    level: str  # "none" | "watch" | "consider_trim" | "strong_trim"
    score: int
    reasons: list[str]
    unrealized_pnl_pct: Optional[float] = None
    current_verdict: Optional[str] = None
    regime: Optional[str] = None
    regime_signal: Optional[float] = None


class TrimSignalsResponse(BaseModel):
    entries: list[TrimSignalEntry]
    computed_at: str


class HoldingResponse(BaseModel):
    id: UUID
    ticker: str
    shares: float
    avg_cost: Optional[float]
    cost_basis_currency: str
    quote_currency: Optional[str] = None
    currency: str  # deprecated alias for cost_basis_currency
    current_price: Optional[float]
    market_value: Optional[float]
    unrealized_pnl: Optional[float]
    unrealized_pnl_pct: Optional[float]
    pnl_unavailable_reason: Optional[str] = None
    last_run: Optional[LastRun]


class HoldingPatch(BaseModel):
    ticker: Optional[str] = None
    shares: Optional[float] = None
    avg_cost: Optional[float] = None
    currency: Optional[str] = None

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        code = v.upper()
        if code not in SUPPORTED_CURRENCIES:
            raise ValueError(f"Unsupported currency: {code}")
        return code


class HoldingCreate(BaseModel):
    ticker: str
    shares: float
    avg_cost: Optional[float] = None
    currency: str = "USD"

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, v: str) -> str:
        code = v.upper()
        if code not in SUPPORTED_CURRENCIES:
            raise ValueError(f"Unsupported currency: {code}")
        return code


class Totals(BaseModel):
    market_value: Optional[float]
    unrealized_pnl: Optional[float]
    unrealized_pnl_pct: Optional[float]


class CurrentResponse(BaseModel):
    snapshot: Optional[PortfolioSnapshotResponse]
    price_unavailable_reason: Optional[str]
    display_currency: str = "USD"
    portfolio_currencies: list[str] = []
    totals_currency: Optional[str] = None
    totals: Totals
    holdings: list[HoldingResponse]


# ── Finnhub price helpers ─────────────────────────────────────────────────────

async def _get_finnhub_key(db: AsyncSession) -> Optional[str]:
    return await get_finnhub_key(db)


def _resolve_stock_currency(
    ticker: str,
    yf_currency: Optional[str],
    metadata_currency: Optional[str],
) -> str:
    if yf_currency:
        return yf_currency.upper()
    if metadata_currency:
        return metadata_currency.upper()
    return "USD"


async def _fetch_price(
    ticker: str,
    api_key: Optional[str],
    metadata_currency: Optional[str] = None,
) -> Optional[PriceQuote]:
    """Single-ticker price fetch in source listing currency."""
    now = time.time()
    if ticker in _price_cache:
        quote, expiry = _price_cache[ticker]
        if now < expiry:
            return quote

    quote: Optional[PriceQuote] = None

    if is_crypto(ticker):
        quote = await _crypto.fetch_price_quote(ticker, finnhub_key=api_key)
    else:
        yf_quote = await _yf.fetch_price_quote(ticker)
        if api_key:
            data: dict = {}
            try:
                async with _get_finnhub_semaphore():
                    raw, _error = await fetch_json(
                        "/quote",
                        api_key,
                        FinnhubCapability.QUOTE,
                        params={"symbol": ticker},
                    )
                    if _error is None:
                        data = raw if isinstance(raw, dict) else {}
                c = data.get("c")
                pc = data.get("pc")
                amount: Optional[float] = None
                if c is not None and c != 0:
                    amount = float(c)
                elif pc is not None and pc != 0:
                    amount = float(pc)
                if amount is not None:
                    currency = _resolve_stock_currency(
                        ticker,
                        yf_quote.currency_code if yf_quote else None,
                        metadata_currency,
                    )
                    quote = PriceQuote(amount=amount, currency=currency)
            except Exception:
                quote = None
        if quote is None:
            quote = yf_quote

    ttl = _CACHE_TTL if quote is not None else 120
    _price_cache[ticker] = (quote, now + ttl)
    return quote


async def _fetch_prices_bulk(
    tickers: list[str],
    api_key: Optional[str],
    db: Optional[AsyncSession] = None,
) -> dict[str, Optional[PriceQuote]]:
    """Fetch prices for many tickers in each instrument's source currency."""
    now = time.time()
    result: dict[str, Optional[PriceQuote]] = {}
    uncached_crypto: list[str] = []
    uncached_stock: list[str] = []

    for ticker in tickers:
        if ticker in _price_cache:
            quote, expiry = _price_cache[ticker]
            if now < expiry:
                result[ticker] = quote
                continue
        if is_crypto(ticker):
            uncached_crypto.append(ticker)
        else:
            uncached_stock.append(ticker)

    metadata_currencies: dict[str, Optional[str]] = {}
    if uncached_stock and db is not None:
        meta_rows = await get_many_ticker_metadata(uncached_stock, db, api_key)
        metadata_currencies = {
            t: row.currency for t, row in meta_rows.items()
        }

    if uncached_crypto:
        crypto_quotes = await _crypto.fetch_prices_batch(uncached_crypto, finnhub_key=api_key)
        for ticker, quote in crypto_quotes.items():
            result[ticker] = quote
            ttl = _CACHE_TTL if quote is not None else 120
            _price_cache[ticker] = (quote, now + ttl)

    if uncached_stock:
        stock_quotes = await asyncio.gather(
            *[
                _fetch_price(
                    t,
                    api_key,
                    metadata_currencies.get(t.upper()) or metadata_currencies.get(t),
                )
                for t in uncached_stock
            ]
        )
        for ticker, quote in zip(uncached_stock, stock_quotes):
            result[ticker] = quote
            ttl = _CACHE_TTL if quote is not None else 120
            _price_cache[ticker] = (quote, now + ttl)

    return result


# ── Portfolio CRUD ────────────────────────────────────────────────────────────

@router.get("/portfolio", response_model=list[PortfolioListItem])
async def list_portfolios(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Portfolio)
        .where(Portfolio.user_id == user.id)
        .options(selectinload(Portfolio.snapshots))
        .order_by(Portfolio.created_at)
    )
    portfolios = result.scalars().all()
    items = []
    for p in portfolios:
        latest = max(p.snapshots, key=lambda s: s.uploaded_at, default=None)
        items.append(PortfolioListItem(
            id=p.id,
            name=p.name,
            created_at=p.created_at,
            last_snapshot_at=latest.uploaded_at if latest else None,
            holding_count=latest.row_count if latest else 0,
        ))
    return items


@router.post("/portfolio", response_model=PortfolioListItem)
async def create_portfolio(
    body: PortfolioCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    p = Portfolio(user_id=user.id, name=body.name)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return PortfolioListItem(
        id=p.id, name=p.name, created_at=p.created_at,
        last_snapshot_at=None, holding_count=0,
    )


@router.delete("/portfolio/{portfolio_id}", status_code=204)
async def delete_portfolio(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    await db.delete(p)
    await db.commit()


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/portfolio/{portfolio_id}/upload", response_model=PortfolioSnapshotResponse)
async def upload_snapshot(
    portfolio_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    portfolio = result.scalar_one_or_none()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    content = await file.read()
    broker, holdings = parse_portfolio_csv(content)

    snapshot = PortfolioSnapshot(
        portfolio_id=portfolio_id,
        broker=broker,
        row_count=len(holdings),
    )
    db.add(snapshot)
    await db.flush()

    for h in holdings:
        db.add(PortfolioHolding(
            snapshot_id=snapshot.id,
            ticker=h.ticker,
            shares=h.shares,
            avg_cost=h.avg_cost,
            currency=h.currency,
        ))

    await db.commit()
    await db.refresh(snapshot)
    return snapshot


# ── Last-runs query helper ────────────────────────────────────────────────────

async def _get_last_runs_for_holdings(
    tickers: list[str],
    user_id,
    db: AsyncSession,
) -> dict[str, "LastRun"]:
    """Fetch the two most-recent completed runs per ticker for this user.
    Populates previous_* fields when the latest run's verdict differs from
    the previous one. Returns empty dict for tickers with no runs."""
    if not tickers:
        return {}

    rows = (await db.execute(
        select(Run, Report)
        .outerjoin(Report, Report.run_id == Run.id)
        .where(
            Run.created_by == user_id,
            Run.ticker.in_(tickers),
            Run.status == RunStatus.completed,
            Run.verdict.isnot(None),
        )
        .order_by(Run.ticker, desc(Run.created_at))
    )).all()

    grouped: dict[str, list[tuple]] = {}
    for run, report in rows:
        bucket = grouped.setdefault(run.ticker, [])
        if len(bucket) < 2:
            bucket.append((run, report))

    last_runs: dict[str, LastRun] = {}
    for ticker, ticker_rows in grouped.items():
        latest_run, latest_report = ticker_rows[0]
        prev_run_id: Optional[UUID] = None
        prev_verdict: Optional[str] = None
        prev_date: Optional[str] = None
        if len(ticker_rows) > 1:
            prev_run, _ = ticker_rows[1]
            if prev_run.verdict and prev_run.verdict.value != latest_run.verdict.value:
                prev_run_id = prev_run.id
                prev_verdict = prev_run.verdict.value
                prev_date = str(prev_run.analysis_date)
        last_runs[ticker] = LastRun(
            run_id=latest_run.id,
            verdict=latest_run.verdict.value,
            analysis_date=str(latest_run.analysis_date),
            suggested_entry=latest_report.suggested_entry if latest_report else None,
            suggested_stop=latest_report.suggested_stop if latest_report else None,
            suggested_target=latest_report.suggested_target if latest_report else None,
            previous_run_id=prev_run_id,
            previous_verdict=prev_verdict,
            previous_analysis_date=prev_date,
        )
    return last_runs


# ── Current holdings (enriched) ───────────────────────────────────────────────

@router.get("/portfolio/{portfolio_id}/current", response_model=CurrentResponse)
async def get_current_holdings(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Portfolio not found")

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot:
        return CurrentResponse(
            snapshot=None,
            price_unavailable_reason=None,
            totals=Totals(market_value=None, unrealized_pnl=None, unrealized_pnl_pct=None),
            holdings=[],
        )

    av_key = await _get_finnhub_key(db)
    price_unavailable_reason: Optional[str] = None
    # Only block pricing if there are stock tickers and no Finnhub key.
    # Crypto tickers use CoinGecko (no key needed), so they are always fetched.
    tickers = [h.ticker for h in snapshot.holdings]
    has_stock = any(not is_crypto(t) for t in tickers)
    if not av_key and has_stock:
        price_unavailable_reason = "no_finnhub_key"

    # Fetch last run verdict per ticker (most recent completed run for this user)
    last_runs = await _get_last_runs_for_holdings(tickers, user.id, db)

    # Fetch all prices in each instrument's source currency
    price_map = await _fetch_prices_bulk(tickers, av_key, db)

    pref_currency = user.preferred_currency.upper()
    portfolio_currencies: set[str] = set()

    enriched: list[HoldingResponse] = []
    total_market_value: float = 0.0
    total_market_value_for_pnl: float = 0.0
    total_cost: float = 0.0
    has_totals = False

    for h in snapshot.holdings:
        quote = price_map.get(h.ticker)
        cost_ccy = (h.currency or "USD").upper()
        quote_ccy = quote.currency_code if quote else quote_currency_from_ticker(h.ticker)

        if quote:
            portfolio_currencies.add(quote.currency_code)

        current_price = quote.amount if quote else None
        market_value = h.shares * current_price if current_price is not None else None

        pnl: Optional[float] = None
        pnl_pct: Optional[float] = None
        pnl_reason: Optional[str] = None
        if current_price is not None and h.avg_cost is not None and h.avg_cost != 0:
            if quote and cost_ccy == quote.currency_code:
                pnl = (current_price - h.avg_cost) * h.shares
                pnl_pct = (current_price / h.avg_cost - 1) * 100
            else:
                pnl_reason = "currency_mismatch"

        include_in_totals = (
            quote is not None
            and quote.currency_code == pref_currency
            and cost_ccy == quote.currency_code
        )
        if include_in_totals and market_value is not None:
            total_market_value += market_value
            has_totals = True
            if h.avg_cost is not None:
                total_market_value_for_pnl += market_value
                total_cost += h.avg_cost * h.shares

        enriched.append(HoldingResponse(
            id=h.id,
            ticker=h.ticker,
            shares=h.shares,
            avg_cost=h.avg_cost,
            cost_basis_currency=cost_ccy,
            quote_currency=quote_ccy,
            currency=cost_ccy,
            current_price=current_price,
            market_value=market_value,
            unrealized_pnl=pnl,
            unrealized_pnl_pct=pnl_pct,
            pnl_unavailable_reason=pnl_reason,
            last_run=last_runs.get(h.ticker),
        ))

    totals_pnl = (
        (total_market_value_for_pnl - total_cost) if has_totals and total_cost else None
    )
    totals_pct = (
        ((total_market_value_for_pnl / total_cost - 1) * 100)
        if has_totals and total_cost
        else None
    )
    totals_currency = pref_currency if has_totals else None
    totals = Totals(
        market_value=total_market_value if has_totals else None,
        unrealized_pnl=totals_pnl,
        unrealized_pnl_pct=totals_pct,
    )

    return CurrentResponse(
        snapshot=snapshot,
        price_unavailable_reason=price_unavailable_reason,
        display_currency=pref_currency,
        portfolio_currencies=sorted(portfolio_currencies),
        totals_currency=totals_currency,
        totals=totals,
        holdings=enriched,
    )


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/portfolio/{portfolio_id}/export")
async def export_portfolio(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    port_result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    portfolio = port_result.scalar_one_or_none()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="No snapshots found for this portfolio")

    av_key = await _get_finnhub_key(db)
    tickers = [h.ticker for h in snapshot.holdings]
    price_map = await _fetch_prices_bulk(tickers, av_key, db)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Ticker",
        "Shares",
        "Avg Cost",
        "Cost Currency",
        "Current Price",
        "Quote Currency",
        "Market Value",
        "Market Value Currency",
        "Unrealized P&L",
        "P&L Currency",
        "Unrealized P&L (%)",
        "Last Analysis Verdict",
        "Last Analysis Date",
    ])

    for h in snapshot.holdings:
        quote = price_map.get(h.ticker)
        cost_ccy = (h.currency or "USD").upper()
        current_price = quote.amount if quote else None
        quote_ccy = quote.currency_code if quote else ""
        market_value = h.shares * current_price if current_price is not None else None

        pnl: Optional[float] = None
        pnl_pct: Optional[float] = None
        pnl_ccy = ""
        if current_price is not None and h.avg_cost is not None and quote and cost_ccy == quote.currency_code:
            pnl = (current_price - h.avg_cost) * h.shares
            pnl_pct = (current_price / h.avg_cost - 1) * 100 if h.avg_cost != 0 else None
            pnl_ccy = quote.currency_code

        run_result = await db.execute(
            select(Run)
            .where(Run.created_by == user.id, Run.ticker == h.ticker, Run.status == RunStatus.completed, Run.verdict.isnot(None))
            .order_by(desc(Run.created_at))
            .limit(1)
        )
        run = run_result.scalar_one_or_none()

        writer.writerow([
            h.ticker,
            h.shares,
            round(h.avg_cost, 2) if h.avg_cost is not None else "",
            cost_ccy,
            round(current_price, 2) if current_price is not None else "",
            quote_ccy,
            round(market_value, 2) if market_value is not None else "",
            quote_ccy,
            round(pnl, 2) if pnl is not None else "",
            pnl_ccy,
            round(pnl_pct, 2) if pnl_pct is not None else "",
            run.verdict.value if run else "",
            str(run.analysis_date) if run else "",
        ])

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    safe_name = portfolio.name.replace(" ", "_")
    filename = f"portfolio-{safe_name}-{date_str}.csv"
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Snapshot management ───────────────────────────────────────────────────────

@router.get("/portfolio/{portfolio_id}/snapshots", response_model=list[PortfolioSnapshotResponse])
async def list_snapshots(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    port_result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    if not port_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Portfolio not found")
    result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .order_by(desc(PortfolioSnapshot.uploaded_at))
    )
    return result.scalars().all()


@router.delete("/portfolio/{portfolio_id}/snapshots/{snapshot_id}", status_code=204)
async def delete_snapshot(
    portfolio_id: UUID,
    snapshot_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    port_result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    if not port_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Portfolio not found")
    snap_result = await db.execute(
        select(PortfolioSnapshot).where(PortfolioSnapshot.id == snapshot_id, PortfolioSnapshot.portfolio_id == portfolio_id)
    )
    snap = snap_result.scalar_one_or_none()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    await db.delete(snap)
    await db.commit()


# ── Holding-level CRUD ────────────────────────────────────────────────────────

async def _get_latest_snapshot(portfolio_id: UUID, user_id, db: AsyncSession) -> PortfolioSnapshot:
    port_result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user_id))
    if not port_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Portfolio not found")
    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snap = snap_result.scalar_one_or_none()
    if not snap:
        raise HTTPException(status_code=404, detail="No snapshot found — upload a CSV first")
    return snap


async def _get_holding_for_user(holding_id: UUID, portfolio_id: UUID, user_id, db: AsyncSession) -> PortfolioHolding:
    result = await db.execute(
        select(PortfolioHolding)
        .join(PortfolioSnapshot, PortfolioHolding.snapshot_id == PortfolioSnapshot.id)
        .join(Portfolio, PortfolioSnapshot.portfolio_id == Portfolio.id)
        .where(PortfolioHolding.id == holding_id, Portfolio.id == portfolio_id, Portfolio.user_id == user_id)
    )
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")
    return h


@router.post("/portfolio/{portfolio_id}/holdings", response_model=dict, status_code=201)
async def add_holding(
    portfolio_id: UUID,
    body: HoldingCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    snap = await _get_latest_snapshot(portfolio_id, user.id, db)
    h = PortfolioHolding(
        snapshot_id=snap.id,
        ticker=body.ticker.upper().strip(),
        shares=body.shares,
        avg_cost=body.avg_cost,
        currency=body.currency.upper(),
    )
    db.add(h)
    snap.row_count += 1
    await db.commit()
    await db.refresh(h)
    return {"id": str(h.id)}


@router.patch("/portfolio/{portfolio_id}/holdings/{holding_id}", status_code=204)
async def update_holding(
    portfolio_id: UUID,
    holding_id: UUID,
    body: HoldingPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    h = await _get_holding_for_user(holding_id, portfolio_id, user.id, db)
    if body.ticker is not None:
        h.ticker = body.ticker.upper().strip()
    if body.shares is not None:
        h.shares = body.shares
    if body.avg_cost is not None:
        h.avg_cost = body.avg_cost
    if body.currency is not None:
        h.currency = body.currency.upper()
    await db.commit()


@router.delete("/portfolio/{portfolio_id}/holdings/{holding_id}", status_code=204)
async def delete_holding(
    portfolio_id: UUID,
    holding_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    h = await _get_holding_for_user(holding_id, portfolio_id, user.id, db)
    snap_result = await db.execute(select(PortfolioSnapshot).where(PortfolioSnapshot.id == h.snapshot_id))
    snap = snap_result.scalar_one_or_none()
    await db.delete(h)
    if snap:
        snap.row_count = max(0, snap.row_count - 1)
    await db.commit()


# ── Portfolio Insights ────────────────────────────────────────────────────────

class InsightGenerateRequest(BaseModel):
    llm_provider: str
    llm_model: str

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: str) -> str:
        return normalize_llm_provider(v)

    @model_validator(mode="after")
    def resolve_model(self) -> "InsightGenerateRequest":
        self.llm_model = resolve_llm_model(self.llm_provider, self.llm_model)
        return self


class ChatRequest(BaseModel):
    message: str
    conversation_history: list[dict] = []
    llm_provider: str
    llm_model: str

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: str) -> str:
        return normalize_llm_provider(v)

    @model_validator(mode="after")
    def resolve_model(self) -> "ChatRequest":
        self.llm_model = resolve_llm_model(self.llm_provider, self.llm_model)
        return self


class ChatResponse(BaseModel):
    response: str
    provider: str
    model: str


class ThesisCrossRefRequest(BaseModel):
    thesis_text: str
    llm_provider: str
    llm_model: str

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: str) -> str:
        return normalize_llm_provider(v)

    @model_validator(mode="after")
    def resolve_model(self) -> "ThesisCrossRefRequest":
        self.llm_model = resolve_llm_model(self.llm_provider, self.llm_model)
        return self


class ThesisCrossRefResponse(BaseModel):
    id: str
    portfolio_id: str
    created_at: str
    llm_provider: str
    llm_model: str
    thesis_text_preview: str
    alignment_score: Optional[int]
    thesis_summary: Optional[str]
    aligned_positions: Optional[list]
    misaligned_positions: Optional[list]
    missing_exposure: Optional[list]
    excess_exposure: Optional[list]
    recommendations: Optional[list]
    summary: Optional[str]
    holdings_snapshot: Optional[dict]
    error: Optional[str]

    @classmethod
    def from_orm(cls, obj) -> "ThesisCrossRefResponse":
        return cls(
            id=str(obj.id),
            portfolio_id=str(obj.portfolio_id),
            created_at=obj.created_at.isoformat(),
            llm_provider=obj.llm_provider,
            llm_model=obj.llm_model,
            thesis_text_preview=obj.thesis_text_preview,
            alignment_score=obj.alignment_score,
            thesis_summary=obj.thesis_summary,
            aligned_positions=obj.aligned_positions,
            misaligned_positions=obj.misaligned_positions,
            missing_exposure=obj.missing_exposure,
            excess_exposure=obj.excess_exposure,
            recommendations=obj.recommendations,
            summary=obj.summary,
            holdings_snapshot=obj.holdings_snapshot,
            error=obj.error,
        )


class InsightResponse(BaseModel):
    id: UUID
    portfolio_id: UUID
    generated_at: datetime
    status: InsightStatus
    trigger: InsightTrigger
    llm_provider: str
    llm_model: str
    health_score: Optional[int]
    overall_stance: Optional[InsightStance]
    summary: Optional[str]
    action_items: Optional[list]
    risk_alerts: Optional[list]
    sector_analysis: Optional[dict]
    strengths: Optional[list]
    weaknesses: Optional[list]
    holdings_snapshot: Optional[dict]
    error: Optional[str]
    model_config = ConfigDict(from_attributes=True)


async def _verify_portfolio_access(portfolio_id: UUID, user_id, db: AsyncSession) -> Portfolio:
    result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


@router.post("/portfolio/{portfolio_id}/insights/generate", response_model=InsightResponse, status_code=202)
async def generate_insight(
    portfolio_id: UUID,
    body: InsightGenerateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)

    # Allow only one running insight per portfolio at a time
    existing = await db.execute(
        select(PortfolioInsight)
        .where(
            PortfolioInsight.portfolio_id == portfolio_id,
            PortfolioInsight.status.in_([InsightStatus.pending, InsightStatus.running]),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An insight generation is already in progress")

    insight = PortfolioInsight(
        portfolio_id=portfolio_id,
        status=InsightStatus.pending,
        trigger=InsightTrigger.manual,
        llm_provider=body.llm_provider,
        llm_model=body.llm_model,
    )
    db.add(insight)
    await db.commit()
    await db.refresh(insight)

    # Fire and forget — insight runner updates status as it progresses
    from app.services.portfolio_insight_runner import generate_portfolio_insight
    asyncio.create_task(generate_portfolio_insight(str(insight.id)))

    return insight


@router.get("/portfolio/{portfolio_id}/insights/latest", response_model=Optional[InsightResponse])
async def get_latest_insight(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)
    result = await db.execute(
        select(PortfolioInsight)
        .where(PortfolioInsight.portfolio_id == portfolio_id)
        .order_by(desc(PortfolioInsight.generated_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.get("/portfolio/{portfolio_id}/insights", response_model=list[InsightResponse])
async def list_insights(
    portfolio_id: UUID,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)
    result = await db.execute(
        select(PortfolioInsight)
        .where(PortfolioInsight.portfolio_id == portfolio_id)
        .order_by(desc(PortfolioInsight.generated_at))
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/portfolio/{portfolio_id}/insights/{insight_id}", response_model=InsightResponse)
async def get_insight(
    portfolio_id: UUID,
    insight_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)
    result = await db.execute(
        select(PortfolioInsight).where(
            PortfolioInsight.id == insight_id,
            PortfolioInsight.portfolio_id == portfolio_id,
        )
    )
    insight = result.scalar_one_or_none()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")
    return insight


@router.post("/portfolio/{portfolio_id}/chat", response_model=ChatResponse)
async def portfolio_chat(
    portfolio_id: UUID,
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)
    from app.services.portfolio_chat_service import generate_chat_response
    try:
        response_text = await generate_chat_response(
            portfolio_id=portfolio_id,
            message=body.message,
            conversation_history=body.conversation_history,
            llm_provider=body.llm_provider,
            llm_model=body.llm_model,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ChatResponse(response=response_text, provider=body.llm_provider, model=body.llm_model)


@router.post("/portfolio/{portfolio_id}/thesis-crossref", response_model=ThesisCrossRefResponse)
async def create_thesis_crossref(
    portfolio_id: UUID,
    body: ThesisCrossRefRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if len(body.thesis_text) < 50 or len(body.thesis_text) > 10000:
        raise HTTPException(status_code=422, detail="thesis_text must be 50–10,000 characters")
    await _verify_portfolio_access(portfolio_id, user.id, db)
    from app.services.portfolio_thesis_runner import run_thesis_crossref
    try:
        crossref = await run_thesis_crossref(
            portfolio_id=portfolio_id,
            thesis_text=body.thesis_text,
            llm_provider=body.llm_provider,
            llm_model=body.llm_model,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ThesisCrossRefResponse.from_orm(crossref)


@router.get("/portfolio/{portfolio_id}/thesis-crossrefs", response_model=list[ThesisCrossRefResponse])
async def list_thesis_crossrefs(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)
    from app.models.portfolio_thesis_crossref import PortfolioThesisCrossRef
    result = await db.execute(
        select(PortfolioThesisCrossRef)
        .where(PortfolioThesisCrossRef.portfolio_id == portfolio_id)
        .order_by(desc(PortfolioThesisCrossRef.created_at))
        .limit(20)
    )
    rows = result.scalars().all()
    return [ThesisCrossRefResponse.from_orm(r) for r in rows]


@router.delete("/portfolio/{portfolio_id}/thesis-crossrefs/{crossref_id}", status_code=204)
async def delete_thesis_crossref(
    portfolio_id: UUID,
    crossref_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)
    from app.models.portfolio_thesis_crossref import PortfolioThesisCrossRef
    result = await db.execute(
        select(PortfolioThesisCrossRef).where(
            PortfolioThesisCrossRef.id == crossref_id,
            PortfolioThesisCrossRef.portfolio_id == portfolio_id,
        )
    )
    crossref = result.scalar_one_or_none()
    if not crossref:
        raise HTTPException(status_code=404, detail="Cross-reference not found")
    await db.delete(crossref)
    await db.commit()


# ── Batch Analyze ─────────────────────────────────────────────────────────────

class BatchAnalyzeRequest(BaseModel):
    llm_provider: str
    llm_model: str
    depth: str = DEFAULT_LLM_DEPTH
    analysts: list[str] = ["market", "social", "news", "fundamentals"]
    response_language: str = DEFAULT_RESPONSE_LANGUAGE
    staleness_days: int = 7

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: str) -> str:
        return normalize_llm_provider(v)

    @field_validator("depth")
    @classmethod
    def validate_depth(cls, v: str) -> str:
        return normalize_llm_depth(v)

    @field_validator("response_language")
    @classmethod
    def validate_response_language(cls, v: str | None) -> str:
        return normalize_response_language(v)

    @model_validator(mode="after")
    def resolve_model(self) -> "BatchAnalyzeRequest":
        self.llm_model = resolve_llm_model(self.llm_provider, self.llm_model)
        return self


class BatchAnalyzeResult(BaseModel):
    queued: list[dict]   # [{ticker, run_id}]
    skipped: list[str]   # tickers that already have a recent/active run


@router.post("/portfolio/{portfolio_id}/runs/batch", response_model=BatchAnalyzeResult)
async def batch_analyze_holdings(
    portfolio_id: UUID,
    body: BatchAnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.run import Run, RunStatus
    from app.services.job_manager import start_runs_batch

    await _verify_portfolio_access(portfolio_id, user.id, db)

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot or not snapshot.holdings:
        raise HTTPException(status_code=404, detail="No holdings found — upload a CSV first")

    cutoff = date.today() - timedelta(days=body.staleness_days)
    queued: list[dict] = []
    skipped: list[str] = []

    for holding in snapshot.holdings:
        recent = (await db.execute(
            select(Run).where(
                Run.created_by == user.id,
                Run.ticker == holding.ticker,
                Run.status.in_([RunStatus.completed, RunStatus.running, RunStatus.pending]),
                Run.analysis_date >= cutoff,
            ).limit(1)
        )).scalar_one_or_none()

        if recent:
            skipped.append(holding.ticker)
            continue

        run = Run(
            created_by=user.id,
            ticker=holding.ticker,
            analysis_date=date.today(),
            llm_provider=body.llm_provider,
            llm_model=body.llm_model,
            depth=body.depth,
            analysts=body.analysts,
            response_language=body.response_language,
            label=f"Portfolio batch: {holding.ticker}",
        )
        db.add(run)
        await db.flush()
        queued.append({"ticker": holding.ticker, "run_id": str(run.id)})

    await db.commit()

    await start_runs_batch([
        (item["run_id"], {
            "ticker": item["ticker"],
            "analysis_date": str(date.today()),
            "llm_provider": body.llm_provider,
            "llm_model": body.llm_model,
            "depth": body.depth,
            "analysts": body.analysts,
            "response_language": body.response_language,
        })
        for item in queued
    ])

    return BatchAnalyzeResult(queued=queued, skipped=skipped)


# ── Earnings Calendar ─────────────────────────────────────────────────────────

_earnings_cache: dict[str, tuple[list, float, FinnhubError | None]] = {}
_EARNINGS_TTL = 21600  # 6 hours


async def _fetch_earnings(ticker: str, api_key: str, days_ahead: int) -> tuple[list[dict], FinnhubError | None]:
    if is_crypto(ticker):
        return [], None  # Crypto has no earnings calendar
    cache_key = f"{ticker}:{days_ahead}"
    now = time.time()
    if cache_key in _earnings_cache:
        data, expiry, cached_error = _earnings_cache[cache_key]
        if now < expiry:
            return data, cached_error
    today = date.today()
    to_date = today + timedelta(days=days_ahead)
    raw, error = await fetch_json(
        "/calendar/earnings",
        api_key,
        FinnhubCapability.EARNINGS_CALENDAR,
        params={"from": today, "to": to_date, "symbol": ticker},
    )
    if error:
        if not should_cache_error(error):
            return [], error
        _earnings_cache[cache_key] = ([], now + 120, error)
        return [], error
    events = raw.get("earningsCalendar", []) if isinstance(raw, dict) else []
    data = [
        {
            "ticker": e.get("symbol", ticker),
            "date": e.get("date"),
            "hour": e.get("hour"),
            "eps_estimate": e.get("epsEstimate"),
            "revenue_estimate": e.get("revenueEstimate"),
            "eps_actual": e.get("epsActual"),
            "revenue_actual": e.get("revenueActual"),
        }
        for e in events
    ]
    _earnings_cache[cache_key] = (data, now + _EARNINGS_TTL, None)
    return data, None


@router.get("/portfolio/{portfolio_id}/earnings")
async def get_portfolio_earnings(
    portfolio_id: UUID,
    days_ahead: int = 30,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot or not snapshot.holdings:
        return {"price_unavailable_reason": None, "earnings_unavailable_reason": None, "events": []}

    av_key = await _get_finnhub_key(db)
    if not av_key:
        return {
            "price_unavailable_reason": "no_finnhub_key",
            "earnings_unavailable_reason": "no_finnhub_key",
            "events": [],
        }

    all_events: list[dict] = []
    errors: list[FinnhubError | None] = []
    results = await asyncio.gather(
        *[_fetch_earnings(h.ticker, av_key, days_ahead) for h in snapshot.holdings]
    )
    for events, error in results:
        all_events.extend(events)
        errors.append(error)

    all_events.sort(key=lambda x: x.get("date") or "")
    return {
        "price_unavailable_reason": None,
        "earnings_unavailable_reason": aggregate_unavailable_reason(errors),
        "events": all_events,
    }


# ── Fundamentals ──────────────────────────────────────────────────────────────

_fundamentals_cache: dict[str, tuple[dict, float, FinnhubError | None]] = {}
_FUNDAMENTALS_TTL = 21600  # 6 hours


def compute_peg(pe: float | None, eps_growth_3y: float | None) -> float | None:
    """Return P/E ÷ 3-year EPS growth rate, or None if not computable."""
    if pe is None or eps_growth_3y is None:
        return None
    if pe <= 0 or eps_growth_3y <= 0:
        return None
    return round(pe / eps_growth_3y, 2)


async def _fetch_fundamentals(ticker: str, api_key: Optional[str]) -> tuple[dict, FinnhubError | None]:
    now = time.time()
    if ticker in _fundamentals_cache:
        data, expiry, cached_error = _fundamentals_cache[ticker]
        if now < expiry:
            return data, cached_error

    if is_crypto(ticker):
        data = await _crypto.fetch_metrics(ticker)
        data["asset_type"] = "crypto"
        _fundamentals_cache[ticker] = (data, now + _FUNDAMENTALS_TTL, None)
        return data, None
    if not api_key:
        return {}, None
    raw, error = await fetch_json(
        "/stock/metric",
        api_key,
        FinnhubCapability.STOCK_METRIC,
        params={"symbol": ticker, "metric": "all"},
    )
    if error:
        data = {"asset_type": "stock"}
        if not should_cache_error(error):
            return data, error
        _fundamentals_cache[ticker] = (data, now + 120, error)
        return data, error
    m = raw.get("metric", {}) if isinstance(raw, dict) else {}
    pe = m.get("peAnnual") if m.get("peAnnual") is not None else m.get("peTTM")
    eps_growth_3y = m.get("epsGrowth3Y")
    data = {
        "asset_type": "stock",
        "pe_ratio": pe,
        "beta": m.get("beta"),
        "week52_high": m.get("52WeekHigh"),
        "week52_low": m.get("52WeekLow"),
        "dividend_yield": m.get("dividendYieldIndicatedAnnual"),
        "eps_ttm": m.get("epsBasicExclExtraItemsTTM"),
        "market_cap": m.get("marketCapitalization"),
        "eps_growth_3y": eps_growth_3y,
        "peg_ratio": compute_peg(pe, eps_growth_3y)
        if pe is not None and eps_growth_3y not in (None, 0)
        else None,
    }
    _fundamentals_cache[ticker] = (data, now + _FUNDAMENTALS_TTL, None)
    return data, None


@router.get("/portfolio/{portfolio_id}/fundamentals")
async def get_portfolio_fundamentals(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot or not snapshot.holdings:
        return {
            "price_unavailable_reason": None,
            "fundamentals_unavailable_reason": None,
            "data": {},
        }

    av_key = await _get_finnhub_key(db)
    tickers = [h.ticker for h in snapshot.holdings]
    # Crypto metrics come from CoinGecko (no key needed); stocks need Finnhub key.
    has_stock = any(not is_crypto(t) for t in tickers)
    if has_stock and not av_key:
        return {
            "price_unavailable_reason": "no_finnhub_key",
            "fundamentals_unavailable_reason": "no_finnhub_key",
            "data": {},
        }

    errors: list[FinnhubError | None] = []
    results = await asyncio.gather(*[_fetch_fundamentals(t, av_key) for t in tickers])
    data: dict[str, dict] = {}
    for ticker, (fundamentals, error) in zip(tickers, results):
        data[ticker] = fundamentals
        if error and not is_crypto(ticker):
            errors.append(error)
    return {
        "price_unavailable_reason": None,
        "fundamentals_unavailable_reason": aggregate_unavailable_reason(errors),
        "data": data,
    }


# ── News Feed ─────────────────────────────────────────────────────────────────

_news_cache: dict[str, tuple[list, float, FinnhubError | None]] = {}
_NEWS_TTL = 3600  # 1 hour


async def _fetch_news(ticker: str, api_key: str, days: int) -> tuple[list[dict], FinnhubError | None]:
    cache_key = f"{ticker}:{days}"
    now = time.time()
    if cache_key in _news_cache:
        data, expiry, cached_error = _news_cache[cache_key]
        if now < expiry:
            return data, cached_error
    today = date.today()
    from_date = today - timedelta(days=days)
    raw, error = await fetch_json(
        "/company-news",
        api_key,
        FinnhubCapability.COMPANY_NEWS,
        params={"symbol": ticker, "from": from_date, "to": today},
    )
    if error:
        if not should_cache_error(error):
            return [], error
        _news_cache[cache_key] = ([], now + 120, error)
        return [], error
    data = [
        {
            "ticker": ticker,
            "datetime": item.get("datetime"),
            "headline": item.get("headline", ""),
            "summary": (item.get("summary") or "")[:300],
            "url": item.get("url", ""),
            "source": item.get("source", ""),
            "image": item.get("image", ""),
        }
        for item in (raw if isinstance(raw, list) else [])
        if item.get("headline")
    ]
    _news_cache[cache_key] = (data, now + _NEWS_TTL, None)
    return data, None


@router.get("/portfolio/{portfolio_id}/news")
async def get_portfolio_news(
    portfolio_id: UUID,
    days: int = 7,
    limit: int = 40,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot or not snapshot.holdings:
        return {
            "price_unavailable_reason": None,
            "news_unavailable_reason": None,
            "articles": [],
        }

    av_key = await _get_finnhub_key(db)
    if not av_key:
        return {
            "price_unavailable_reason": "no_finnhub_key",
            "news_unavailable_reason": "no_finnhub_key",
            "articles": [],
        }

    all_articles: list[dict] = []
    errors: list[FinnhubError | None] = []
    results = await asyncio.gather(
        *[_fetch_news(h.ticker, av_key, days) for h in snapshot.holdings]
    )
    for articles, error in results:
        all_articles.extend(articles)
        errors.append(error)

    all_articles.sort(key=lambda x: x.get("datetime") or 0, reverse=True)
    return {
        "price_unavailable_reason": None,
        "news_unavailable_reason": aggregate_unavailable_reason(errors),
        "articles": all_articles[:limit],
    }


# ── Sector gaps ───────────────────────────────────────────────────────────────


@router.get("/portfolio/{portfolio_id}/sector-gaps")
async def get_sector_gaps(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    from app.services.sp500_sectors import SP500_SECTOR_WEIGHTS

    finnhub_key = await _get_finnhub_key(db)

    try:
        snap = await _get_latest_snapshot(portfolio_id, user.id, db)
    except HTTPException:
        return []

    holdings = (await db.execute(
        select(PortfolioHolding).where(PortfolioHolding.snapshot_id == snap.id)
    )).scalars().all()

    if not holdings:
        return []

    tickers = [h.ticker for h in holdings]
    metadata = await get_many_ticker_metadata(tickers, db, finnhub_key)
    sector_by_ticker = {
        ticker: row.sector
        for ticker, row in metadata.items()
        if row.sector
    }
    if not sector_by_ticker:
        return []

    prices_map = await _fetch_prices_bulk(list(sector_by_ticker.keys()), finnhub_key, db)
    pref_currency = user.preferred_currency.upper()

    sector_values: dict[str, float] = {}
    total_value = 0.0
    for holding in holdings:
        quote = prices_map.get(holding.ticker)
        if quote is None or quote.currency_code != pref_currency:
            continue
        market_value = quote.amount * holding.shares
        sector = sector_by_ticker.get(holding.ticker.upper())
        if not sector:
            continue
        sector_values[sector] = sector_values.get(sector, 0.0) + market_value
        total_value += market_value

    if total_value == 0:
        return []

    all_sectors = set(list(sector_values.keys()) + list(SP500_SECTOR_WEIGHTS.keys()))
    result = []
    for sector in all_sectors:
        your_weight = sector_values.get(sector, 0.0) / total_value
        sp500_weight = SP500_SECTOR_WEIGHTS.get(sector, 0.0)
        result.append({
            "sector": sector,
            "your_weight": round(your_weight, 4),
            "sp500_weight": round(sp500_weight, 4),
            "delta": round(your_weight - sp500_weight, 4),
        })
    return sorted(result, key=lambda x: x["delta"])


class DiscoverRequest(BaseModel):
    llm_provider: str | None = None
    llm_model: str | None = None

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return normalize_llm_provider(v)

    @model_validator(mode="after")
    def resolve_model(self) -> "DiscoverRequest":
        if self.llm_provider:
            self.llm_model = resolve_llm_model(self.llm_provider, self.llm_model)
        return self


# ── Stock discovery ───────────────────────────────────────────────────────────

_discover_cache: dict[str, tuple[list, float]] = {}
_DISCOVER_TTL = 1800  # 30 minutes
_discover_in_flight: set[str] = set()


@router.post("/portfolio/{portfolio_id}/discover")
async def discover_stocks(
    portfolio_id: UUID,
    body: DiscoverRequest = Body(default_factory=DiscoverRequest),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    from app.services.sp500_sectors import SECTOR_LEADERS
    import app.routers.market as _market_module
    from app.services.llm_selection import pick_llm_for_user
    from app.services.portfolio_insight_runner import _call_llm, _get_api_key

    # Determine LLM provider/model
    if body.llm_provider:
        llm_provider = body.llm_provider
        llm_model = body.llm_model
    else:
        picked = await pick_llm_for_user(db, user)
        if not picked:
            raise HTTPException(status_code=422, detail="No LLM provider key configured. Add one in Settings.")
        llm_provider, llm_model = picked

    provider_for_key = llm_provider if llm_provider != "vllm" else "openai"
    api_key = await _get_api_key(provider_for_key, db)
    if llm_provider not in LOCAL_LLM_PROVIDERS and not api_key:
        raise HTTPException(status_code=422, detail="LLM provider key not found.")

    cache_key = f"{portfolio_id}:{llm_provider}:{llm_model}"
    now = time.time()
    if cache_key in _discover_cache:
        cached, expiry = _discover_cache[cache_key]
        if now < expiry:
            return {"recommendations": cached, "cached": True}

    # Return last cached result if a request is already in-flight for this portfolio
    if cache_key in _discover_in_flight:
        cached_entry = _discover_cache.get(cache_key)
        if cached_entry:
            return {"recommendations": cached_entry[0], "cached": True}
        return {"recommendations": [], "cached": False}

    _discover_in_flight.add(cache_key)

    # Get current portfolio tickers to exclude
    try:
        snap = await _get_latest_snapshot(portfolio_id, user.id, db)
    except HTTPException:
        _discover_in_flight.discard(cache_key)
        raise HTTPException(status_code=404, detail="No portfolio snapshot found.")
    holdings = (await db.execute(
        select(PortfolioHolding).where(PortfolioHolding.snapshot_id == snap.id)
    )).scalars().all()
    held_tickers = {h.ticker.upper() for h in holdings}

    # Fetch sector gaps
    gaps = await get_sector_gaps(portfolio_id, db, user)

    # Read trending tickers from shared market cache
    trending_tickers, _trending_expiry = _market_module._trending_cache
    trending_candidates = [
        {"ticker": t, "tag": "Trending", "sector": ""}
        for t in trending_tickers if t.upper() not in held_tickers
    ][:5]

    # Read movers from shared quote cache — tickers with |change_pct| >= 3%
    mover_candidates = []
    for ticker in _market_module.MARKET_UNIVERSE:
        if ticker in held_tickers:
            continue
        cached_quote = _market_module._quote_cache.get(ticker)
        if cached_quote:
            quote_data, q_expiry = cached_quote
            if time.time() < q_expiry:
                pct = quote_data.get("change_pct") or 0
                if abs(pct) >= 3.0:
                    mover_candidates.append({"ticker": ticker, "tag": "Mover", "sector": "", "_pct": pct})
    mover_candidates.sort(key=lambda x: abs(x["_pct"]), reverse=True)
    mover_candidates = [{"ticker": m["ticker"], "tag": m["tag"], "sector": m["sector"]} for m in mover_candidates[:4]]

    # Assemble gap fill candidates from underweight sectors
    underweight = [g["sector"] for g in gaps if g["delta"] < -0.05]
    gap_candidates = []
    for sector in underweight:
        for t in SECTOR_LEADERS.get(sector, []):
            if t not in held_tickers:
                gap_candidates.append({"ticker": t, "tag": "Gap Fill", "sector": sector})

    candidates = (gap_candidates + trending_candidates + mover_candidates)[:12]

    if not candidates:
        _discover_in_flight.discard(cache_key)
        return {"recommendations": [], "cached": False}

    # Build prompt
    held_summary = ", ".join(list(held_tickers)[:15])
    underweight_summary = ", ".join(underweight[:5]) if underweight else "none"
    candidate_lines = "\n".join(
        f"- {c['ticker']} ({c['tag']}, {c['sector']})" for c in candidates
    )
    prompt = f"""You are a portfolio research assistant. The user holds: {held_summary}.
Their portfolio is underweight vs S&P 500 in these sectors: {underweight_summary}.

Below are candidate stocks to consider. For each, write one concise sentence (max 20 words) explaining why it is relevant given the portfolio context.
Return a JSON array: [{{"ticker": "XYZ", "tag": "Gap Fill", "sector": "Healthcare", "reason": "..."}}]
Only include candidates you have a meaningful reason for. Return at most 8.

Candidates:
{candidate_lines}"""

    try:
        raw = await _call_llm(llm_provider, llm_model, api_key, prompt)
        import json as _json
        # Strip markdown fences if present
        cleaned = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        recommendations = _json.loads(cleaned)
        if not isinstance(recommendations, list):
            recommendations = []
    except Exception:
        recommendations = [
            {"ticker": c["ticker"], "tag": c["tag"], "sector": c["sector"], "reason": ""}
            for c in candidates[:6]
        ]
    finally:
        _discover_in_flight.discard(cache_key)

    _discover_cache[cache_key] = (recommendations, now + _DISCOVER_TTL)
    return {"recommendations": recommendations, "cached": False}


@router.get("/portfolio/{portfolio_id}/behavioral-alerts")
async def get_behavioral_alerts(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)
    from app.services.behavioral_alerts_service import compute_behavioral_alerts
    alerts = await compute_behavioral_alerts(portfolio_id, user.id, db)
    return {
        "alerts": alerts,
        "alert_count": len(alerts),
        "critical_count": sum(1 for a in alerts if a["severity"] == "critical"),
        "warning_count": sum(1 for a in alerts if a["severity"] == "warning"),
        "info_count": sum(1 for a in alerts if a["severity"] == "info"),
    }


@router.get("/portfolio/{portfolio_id}/delivery-settings")
async def get_delivery_settings(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)
    from app.models.portfolio_delivery_settings import PortfolioDeliverySettings
    result = await db.execute(
        select(PortfolioDeliverySettings).where(
            PortfolioDeliverySettings.portfolio_id == portfolio_id
        )
    )
    ds = result.scalar_one_or_none()
    if not ds:
        return {
            "email_enabled": False,
            "email_address": None,
            "webhook_enabled": False,
            "webhook_url": None,
            "webhook_format": "json",
            "telegram_chat_id": None,
            "delivery_timezone": "UTC",
        }
    return {
        "email_enabled": ds.email_enabled,
        "email_address": ds.email_address,
        "webhook_enabled": ds.webhook_enabled,
        "webhook_url": ds.webhook_url,
        "webhook_format": ds.webhook_format,
        "telegram_chat_id": ds.telegram_chat_id,
        "delivery_timezone": ds.delivery_timezone,
    }


@router.put("/portfolio/{portfolio_id}/delivery-settings")
async def update_delivery_settings(
    portfolio_id: UUID,
    body: UpdateDeliverySettingsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _verify_portfolio_access(portfolio_id, user.id, db)
    from app.models.portfolio_delivery_settings import PortfolioDeliverySettings

    result = await db.execute(
        select(PortfolioDeliverySettings).where(
            PortfolioDeliverySettings.portfolio_id == portfolio_id
        )
    )
    ds = result.scalar_one_or_none()
    if not ds:
        ds = PortfolioDeliverySettings(portfolio_id=portfolio_id)
        db.add(ds)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(ds, field, value)

    await db.commit()
    await db.refresh(ds)
    return {
        "email_enabled": ds.email_enabled,
        "email_address": ds.email_address,
        "webhook_enabled": ds.webhook_enabled,
        "webhook_url": ds.webhook_url,
        "webhook_format": ds.webhook_format,
        "telegram_chat_id": ds.telegram_chat_id,
        "delivery_timezone": ds.delivery_timezone,
    }


@router.post("/portfolio/{portfolio_id}/delivery-settings/test-webhook")
async def test_webhook_delivery(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    portfolio = await _verify_portfolio_access(portfolio_id, user.id, db)
    from app.models.portfolio_delivery_settings import PortfolioDeliverySettings
    from app.models.portfolio_insight import InsightStatus, PortfolioInsight
    from app.services.delivery_service import send_webhook_brief

    ds_result = await db.execute(
        select(PortfolioDeliverySettings).where(
            PortfolioDeliverySettings.portfolio_id == portfolio_id
        )
    )
    ds = ds_result.scalar_one_or_none()
    if not ds or not ds.webhook_url:
        raise HTTPException(status_code=400, detail="No webhook URL configured")
    if ds.webhook_format == "telegram" and not ds.telegram_chat_id:
        raise HTTPException(status_code=400, detail="No Telegram chat ID configured")

    insight_result = await db.execute(
        select(PortfolioInsight)
        .where(
            PortfolioInsight.portfolio_id == portfolio_id,
            PortfolioInsight.status == InsightStatus.completed,
        )
        .order_by(desc(PortfolioInsight.generated_at))
        .limit(1)
    )
    insight = insight_result.scalar_one_or_none()

    try:
        if insight:
            date_str = (f"{insight.generated_at.strftime('%b')} {insight.generated_at.day}, {insight.generated_at.year}" if insight.generated_at else "Today")
            await send_webhook_brief(
                webhook_url=ds.webhook_url,
                webhook_format=ds.webhook_format,
                portfolio_id=str(portfolio_id),
                portfolio_name=portfolio.name,
                generated_at=insight.generated_at.isoformat() if insight.generated_at else "",
                health=insight.health_score or 0,
                stance=insight.overall_stance.value if insight.overall_stance else "neutral",
                summary=insight.summary or "",
                action_items=insight.action_items or [],
                risk_alerts=insight.risk_alerts or [],
                sector_analysis=insight.sector_analysis,
                strengths=insight.strengths or [],
                weaknesses=insight.weaknesses or [],
                date_str=date_str,
                telegram_chat_id=ds.telegram_chat_id,
            )
        else:
            message = "This is a test webhook from AgentFloor (no insight generated yet)"
            if ds.webhook_format == "telegram":
                payload = {
                    "chat_id": ds.telegram_chat_id,
                    "text": f"<b>AgentFloor test</b>\n{message}",
                    "parse_mode": "HTML",
                }
            elif ds.webhook_format == "slack":
                payload = {"text": message}
            else:
                payload = {
                    "portfolio_id": str(portfolio_id),
                    "portfolio_name": portfolio.name,
                    "test": True,
                    "message": message,
                }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    ds.webhook_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Webhook delivery failed: {exc}")

    return {"sent": True}


# ── Regime Analysis ───────────────────────────────────────────────────────────

@router.get("/portfolio/{portfolio_id}/regime")
async def get_portfolio_regime(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return Markov regime analysis for all tickers in the portfolio's latest snapshot.
    Returns {} gracefully if no holdings or all tickers fail."""
    await _verify_portfolio_access(portfolio_id, user.id, db)
    settings = await get_app_settings(db)
    if not settings["enable_markov_regime"]:
        return {}

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot or not snapshot.holdings:
        return {}

    tickers = [h.ticker for h in snapshot.holdings]
    return await get_regime_for_portfolio(tickers)


# ── Trim Signals ──────────────────────────────────────────────────────────────

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@router.get("/portfolio/{portfolio_id}/trim-signals", response_model=TrimSignalsResponse)
async def get_portfolio_trim_signals(
    portfolio_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    settings = await get_app_settings(db)
    if not settings["enable_markov_regime"]:
        return TrimSignalsResponse(entries=[], computed_at=_utc_now_iso())

    p_result = await db.execute(
        select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id)
    )
    if not p_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Portfolio not found")

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot or not snapshot.holdings:
        return TrimSignalsResponse(entries=[], computed_at=_utc_now_iso())

    tickers = [h.ticker for h in snapshot.holdings]

    av_key = await _get_finnhub_key(db)
    pref_currency = user.preferred_currency.upper()
    last_runs, regime_map, price_map = await asyncio.gather(
        _get_last_runs_for_holdings(tickers, user.id, db),
        get_regime_for_portfolio(tickers),
        _fetch_prices_bulk(tickers, av_key, db),
    )

    fundamentals_map: dict[str, dict] = {}
    if av_key:
        fundamentals_list = await asyncio.gather(
            *[_fetch_fundamentals(ticker, av_key) for ticker in tickers]
        )
        fundamentals_map = dict(zip(tickers, fundamentals_list))

    total_value = 0.0
    holding_values: dict[str, float] = {}
    for h in snapshot.holdings:
        quote = price_map.get(h.ticker)
        if quote is not None and quote.currency_code == pref_currency:
            v = h.shares * quote.amount
            holding_values[str(h.id)] = v
            total_value += v

    entries: list[TrimSignalEntry] = []
    for h in snapshot.holdings:
        quote = price_map.get(h.ticker)
        cost_ccy = (h.currency or "USD").upper()
        pnl_pct: Optional[float] = None
        if (
            quote is not None
            and h.avg_cost is not None
            and h.avg_cost != 0
            and cost_ccy == quote.currency_code
        ):
            pnl_pct = (quote.amount / h.avg_cost - 1) * 100

        weight_pct: Optional[float] = None
        v = holding_values.get(str(h.id))
        if v is not None and total_value > 0:
            weight_pct = v / total_value * 100

        last_run = last_runs.get(h.ticker)
        # Backend stores verdict in lowercase ("buy"/"sell"/"hold"); the scoring
        # function expects uppercase for human-readable reason strings.
        current_verdict_raw = last_run.verdict if last_run else None
        previous_verdict_raw = last_run.previous_verdict if last_run else None
        current_verdict = current_verdict_raw.upper() if current_verdict_raw else None
        previous_verdict = previous_verdict_raw.upper() if previous_verdict_raw else None

        if last_run:
            regime_data = regime_map.get(h.ticker)
            regime = regime_data.get("current_regime") if regime_data else None
            regime_signal = regime_data.get("signal") if regime_data else None

            fund = fundamentals_map.get(h.ticker, {})
            peg = fund.get("peg_ratio")
        else:
            regime = None
            regime_signal = None
            peg = None
            pnl_pct = None
            weight_pct = None

        signal = score_trim_signal(
            ticker=h.ticker,
            unrealized_pnl_pct=pnl_pct,
            current_verdict=current_verdict,
            previous_verdict=previous_verdict,
            regime=regime,
            regime_signal=regime_signal,
            peg=peg,
            portfolio_weight_pct=weight_pct,
        )

        entries.append(TrimSignalEntry(
            holding_id=h.id,
            ticker=h.ticker,
            level=signal.level,
            score=signal.score,
            reasons=signal.reasons,
            unrealized_pnl_pct=pnl_pct,
            current_verdict=current_verdict,
            regime=regime,
            regime_signal=regime_signal,
        ))

    entries.sort(key=lambda e: e.score, reverse=True)
    return TrimSignalsResponse(
        entries=entries,
        computed_at=_utc_now_iso(),
    )
