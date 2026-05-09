import asyncio
import csv
import io
import time
from uuid import UUID
from datetime import datetime, timezone, date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
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
from app.models.api_key import ApiKey
from app.services.encryption import decrypt_key
from app.services.portfolio_parser import parse_portfolio_csv
from app.utils.asset_type import is_crypto
import app.services.crypto_data_service as _crypto
import app.services.fx_service as fx

router = APIRouter()

# In-process price cache: ticker → (price, expiry_unix_ts)
_price_cache: dict[str, tuple[Optional[float], float]] = {}
_CACHE_TTL = 3600  # 1 hour


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


class HoldingResponse(BaseModel):
    id: UUID
    ticker: str
    shares: float
    avg_cost: Optional[float]
    currency: str
    current_price: Optional[float]
    market_value: Optional[float]
    unrealized_pnl: Optional[float]
    unrealized_pnl_pct: Optional[float]
    last_run: Optional[LastRun]


class HoldingPatch(BaseModel):
    ticker: Optional[str] = None
    shares: Optional[float] = None
    avg_cost: Optional[float] = None
    currency: Optional[str] = None


class HoldingCreate(BaseModel):
    ticker: str
    shares: float
    avg_cost: Optional[float] = None
    currency: str = "USD"


class Totals(BaseModel):
    market_value: Optional[float]
    unrealized_pnl: Optional[float]
    unrealized_pnl_pct: Optional[float]


class CurrentResponse(BaseModel):
    snapshot: Optional[PortfolioSnapshotResponse]
    price_unavailable_reason: Optional[str]
    display_currency: str = "USD"
    totals: Totals
    holdings: list[HoldingResponse]


# ── Finnhub price helpers ─────────────────────────────────────────────────────

async def _get_finnhub_key(db: AsyncSession) -> Optional[str]:
    result = await db.execute(select(ApiKey).where(ApiKey.provider == "finnhub"))
    key_row = result.scalar_one_or_none()
    if not key_row or not key_row.is_valid:
        return None
    return decrypt_key(key_row.encrypted_key)


async def _fetch_price(ticker: str, api_key: Optional[str]) -> Optional[float]:
    """Single-ticker price fetch, used by insight runner and individual holding edit.
    For bulk portfolio pricing use _fetch_prices_bulk."""
    now = time.time()
    if ticker in _price_cache:
        price, expiry = _price_cache[ticker]
        if now < expiry:
            return price

    if is_crypto(ticker):
        price = await _crypto.fetch_price(ticker, finnhub_key=api_key)
    else:
        if not api_key:
            return None
        url = f"https://finnhub.io/api/v1/quote?symbol={ticker}&token={api_key}"
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(url)
                r.raise_for_status()
                data = r.json()
            c = data.get("c")
            price = float(c) if c is not None and c != 0 else None
        except Exception:
            price = None

    _price_cache[ticker] = (price, now + _CACHE_TTL)
    return price


async def _fetch_prices_bulk(
    tickers: list[str],
    api_key: Optional[str],
) -> dict[str, Optional[float]]:
    """Fetch prices for many tickers efficiently.
    Crypto tickers are batched into a single CoinGecko call to avoid rate limits.
    Stock tickers are fetched concurrently via Finnhub.
    Portfolio-level 1h cache is checked/updated for all tickers.
    """
    now = time.time()
    result: dict[str, Optional[float]] = {}
    uncached_crypto: list[str] = []
    uncached_stock: list[str] = []

    for ticker in tickers:
        if ticker in _price_cache:
            price, expiry = _price_cache[ticker]
            if now < expiry:
                result[ticker] = price
                continue
        if is_crypto(ticker):
            uncached_crypto.append(ticker)
        else:
            uncached_stock.append(ticker)

    # Batch all crypto in a single CoinGecko /simple/price call
    if uncached_crypto:
        crypto_prices = await _crypto.fetch_prices_batch(uncached_crypto, finnhub_key=api_key)
        for ticker, price in crypto_prices.items():
            result[ticker] = price
            _price_cache[ticker] = (price, now + _CACHE_TTL)

    # Fetch stocks concurrently via Finnhub
    if uncached_stock and api_key:
        stock_prices = await asyncio.gather(*[_fetch_price(t, api_key) for t in uncached_stock])
        for ticker, price in zip(uncached_stock, stock_prices):
            result[ticker] = price
    elif uncached_stock:
        for ticker in uncached_stock:
            result[ticker] = None

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
    last_runs: dict[str, LastRun] = {}
    if tickers:
        for ticker in tickers:
            run_result = await db.execute(
                select(Run)
                .where(Run.created_by == user.id, Run.ticker == ticker, Run.status == RunStatus.completed, Run.verdict.isnot(None))
                .order_by(desc(Run.created_at))
                .limit(1)
            )
            run = run_result.scalar_one_or_none()
            if run:
                last_runs[ticker] = LastRun(
                    run_id=run.id,
                    verdict=run.verdict.value,
                    analysis_date=str(run.analysis_date),
                    suggested_entry=run.suggested_entry,
                    suggested_stop=run.suggested_stop,
                    suggested_target=run.suggested_target,
                )

    # Fetch all prices — crypto batched into one CoinGecko call, stocks via Finnhub
    price_map = await _fetch_prices_bulk(tickers, av_key)

    pref_currency = user.preferred_currency.upper()

    # Gather rates needed: user's display currency + any non-USD holding cost-basis currencies
    unique_holding_currencies = {
        (h.currency or "USD").upper()
        for h in snapshot.holdings
        if (h.currency or "USD").upper() != "USD"
    }
    currencies_to_fetch = list((unique_holding_currencies | {pref_currency}) - {"USD"})
    if currencies_to_fetch:
        rate_values = await asyncio.gather(*[fx.get_rate(c) for c in currencies_to_fetch])
        rates: dict[str, float] = dict(zip(currencies_to_fetch, rate_values))
    else:
        rates = {}
    rates["USD"] = 1.0
    pref_rate = rates.get(pref_currency, 1.0)

    enriched: list[HoldingResponse] = []
    total_market_value_usd: float = 0.0
    total_cost_usd: float = 0.0
    has_price = False

    for h in snapshot.holdings:
        price_usd = price_map[h.ticker]
        holding_currency = (h.currency or "USD").upper()
        holding_rate = rates.get(holding_currency, 1.0)

        # Convert avg_cost from holding's cost-basis currency to USD
        avg_cost_usd: Optional[float] = None
        if h.avg_cost is not None:
            avg_cost_usd = h.avg_cost / holding_rate if holding_rate else h.avg_cost

        # Compute P&L in USD
        market_value_usd: Optional[float] = h.shares * price_usd if price_usd is not None else None
        pnl_usd: Optional[float] = None
        pnl_pct: Optional[float] = None
        if price_usd is not None and avg_cost_usd is not None and avg_cost_usd != 0:
            pnl_usd = (price_usd - avg_cost_usd) * h.shares
            pnl_pct = (price_usd / avg_cost_usd - 1) * 100

        if market_value_usd is not None:
            total_market_value_usd += market_value_usd
            has_price = True
            if avg_cost_usd is not None:
                total_cost_usd += avg_cost_usd * h.shares

        enriched.append(HoldingResponse(
            id=h.id,
            ticker=h.ticker,
            shares=h.shares,
            avg_cost=fx.apply(avg_cost_usd, pref_rate),
            currency=pref_currency,
            current_price=fx.apply(price_usd, pref_rate),
            market_value=fx.apply(market_value_usd, pref_rate),
            unrealized_pnl=fx.apply(pnl_usd, pref_rate),
            unrealized_pnl_pct=pnl_pct,
            last_run=last_runs.get(h.ticker),
        ))

    totals_pnl_usd = (total_market_value_usd - total_cost_usd) if has_price and total_cost_usd else None
    totals_pct = ((total_market_value_usd / total_cost_usd - 1) * 100) if has_price and total_cost_usd else None
    totals = Totals(
        market_value=(total_market_value_usd * pref_rate) if has_price else None,
        unrealized_pnl=fx.apply(totals_pnl_usd, pref_rate),
        unrealized_pnl_pct=totals_pct,
    )

    return CurrentResponse(
        snapshot=snapshot,
        price_unavailable_reason=price_unavailable_reason,
        display_currency=pref_currency,
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
    pref_currency = user.preferred_currency.upper()
    pref_rate = await fx.get_rate(pref_currency)
    c = pref_currency

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Ticker", "Shares", f"Avg Cost ({c})", f"Current Price ({c})", f"Market Value ({c})",
        f"Unrealized P&L ({c})", "Unrealized P&L (%)", "Last Analysis Verdict", "Last Analysis Date",
    ])

    for h in snapshot.holdings:
        price_usd: Optional[float] = None
        if av_key or is_crypto(h.ticker):
            price_usd = await _fetch_price(h.ticker, av_key)
        holding_rate = await fx.get_rate((h.currency or "USD").upper())
        avg_cost_usd = (h.avg_cost / holding_rate) if h.avg_cost is not None and holding_rate else h.avg_cost
        avg_cost_display = round(avg_cost_usd * pref_rate, 2) if avg_cost_usd is not None else ""
        price = round(price_usd * pref_rate, 2) if price_usd is not None else None
        market_value = round(h.shares * price_usd * pref_rate, 2) if price_usd is not None else ""
        pnl_usd = ((price_usd - avg_cost_usd) * h.shares) if price_usd is not None and avg_cost_usd is not None else None
        pnl = round(pnl_usd * pref_rate, 2) if pnl_usd is not None else ""
        pnl_pct = round((price_usd / avg_cost_usd - 1) * 100, 2) if price_usd is not None and avg_cost_usd is not None and avg_cost_usd != 0 else ""

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
            avg_cost_display,
            round(price, 2) if price is not None else "",
            market_value,
            pnl,
            pnl_pct,
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
        currency=body.currency,
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
        h.currency = body.currency
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


# ── Batch Analyze ─────────────────────────────────────────────────────────────

class BatchAnalyzeRequest(BaseModel):
    llm_provider: str
    llm_model: str
    depth: str = "standard"
    analysts: list[str] = ["market", "social", "news", "fundamentals", "technical"]
    staleness_days: int = 7


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
    from app.services.job_manager import start_run

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
            label=f"Portfolio batch: {holding.ticker}",
        )
        db.add(run)
        await db.flush()
        queued.append({"ticker": holding.ticker, "run_id": str(run.id)})

    await db.commit()

    for item in queued:
        await start_run(item["run_id"], {
            "ticker": item["ticker"],
            "analysis_date": str(date.today()),
            "llm_provider": body.llm_provider,
            "llm_model": body.llm_model,
            "depth": body.depth,
            "analysts": body.analysts,
        })

    return BatchAnalyzeResult(queued=queued, skipped=skipped)


# ── Earnings Calendar ─────────────────────────────────────────────────────────

_earnings_cache: dict[str, tuple[list, float]] = {}
_EARNINGS_TTL = 21600  # 6 hours


async def _fetch_earnings(ticker: str, api_key: str, days_ahead: int) -> list[dict]:
    if is_crypto(ticker):
        return []  # Crypto has no earnings calendar
    cache_key = f"{ticker}:{days_ahead}"
    now = time.time()
    if cache_key in _earnings_cache:
        data, expiry = _earnings_cache[cache_key]
        if now < expiry:
            return data
    try:
        today = date.today()
        to_date = today + timedelta(days=days_ahead)
        url = (
            f"https://finnhub.io/api/v1/calendar/earnings"
            f"?from={today}&to={to_date}&symbol={ticker}&token={api_key}"
        )
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url)
            r.raise_for_status()
            raw = r.json().get("earningsCalendar", [])
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
            for e in raw
        ]
    except Exception:
        data = []
    _earnings_cache[cache_key] = (data, now + _EARNINGS_TTL)
    return data


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
        return {"price_unavailable_reason": None, "events": []}

    av_key = await _get_finnhub_key(db)
    if not av_key:
        return {"price_unavailable_reason": "no_finnhub_key", "events": []}

    all_events: list[dict] = []
    results = await asyncio.gather(
        *[_fetch_earnings(h.ticker, av_key, days_ahead) for h in snapshot.holdings]
    )
    for events in results:
        all_events.extend(events)

    all_events.sort(key=lambda x: x.get("date") or "")
    return {"price_unavailable_reason": None, "events": all_events}


# ── Fundamentals ──────────────────────────────────────────────────────────────

_fundamentals_cache: dict[str, tuple[dict, float]] = {}
_FUNDAMENTALS_TTL = 21600  # 6 hours


async def _fetch_fundamentals(ticker: str, api_key: Optional[str]) -> dict:
    now = time.time()
    if ticker in _fundamentals_cache:
        data, expiry = _fundamentals_cache[ticker]
        if now < expiry:
            return data

    if is_crypto(ticker):
        data = await _crypto.fetch_metrics(ticker)
        data["asset_type"] = "crypto"
    elif api_key:
        try:
            url = f"https://finnhub.io/api/v1/stock/metric?symbol={ticker}&metric=all&token={api_key}"
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(url)
                r.raise_for_status()
                m = r.json().get("metric", {})
            data = {
                "asset_type": "stock",
                "pe_ratio": m.get("peAnnual") or m.get("peTTM"),
                "beta": m.get("beta"),
                "week52_high": m.get("52WeekHigh"),
                "week52_low": m.get("52WeekLow"),
                "dividend_yield": m.get("dividendYieldIndicatedAnnual"),
                "eps_ttm": m.get("epsBasicExclExtraItemsTTM"),
                "market_cap": m.get("marketCapitalization"),
            }
        except Exception:
            data = {"asset_type": "stock"}
    else:
        return {}

    _fundamentals_cache[ticker] = (data, now + _FUNDAMENTALS_TTL)
    return data


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
        return {"price_unavailable_reason": None, "data": {}}

    av_key = await _get_finnhub_key(db)
    tickers = [h.ticker for h in snapshot.holdings]
    # Crypto metrics come from CoinGecko (no key needed); stocks need Finnhub key.
    has_stock = any(not is_crypto(t) for t in tickers)
    if has_stock and not av_key:
        return {"price_unavailable_reason": "no_finnhub_key", "data": {}}

    results = await asyncio.gather(*[_fetch_fundamentals(t, av_key) for t in tickers])
    return {"price_unavailable_reason": None, "data": dict(zip(tickers, results))}


# ── News Feed ─────────────────────────────────────────────────────────────────

_news_cache: dict[str, tuple[list, float]] = {}
_NEWS_TTL = 3600  # 1 hour


async def _fetch_news(ticker: str, api_key: str, days: int) -> list[dict]:
    cache_key = f"{ticker}:{days}"
    now = time.time()
    if cache_key in _news_cache:
        data, expiry = _news_cache[cache_key]
        if now < expiry:
            return data
    try:
        today = date.today()
        from_date = today - timedelta(days=days)
        url = (
            f"https://finnhub.io/api/v1/company-news"
            f"?symbol={ticker}&from={from_date}&to={today}&token={api_key}"
        )
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url)
            r.raise_for_status()
            raw = r.json()
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
    except Exception:
        data = []
    _news_cache[cache_key] = (data, now + _NEWS_TTL)
    return data


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
        return {"price_unavailable_reason": None, "articles": []}

    av_key = await _get_finnhub_key(db)
    if not av_key:
        return {"price_unavailable_reason": "no_finnhub_key", "articles": []}

    results = await asyncio.gather(
        *[_fetch_news(h.ticker, av_key, days) for h in snapshot.holdings]
    )
    all_articles: list[dict] = []
    for articles in results:
        all_articles.extend(articles)

    all_articles.sort(key=lambda x: x.get("datetime") or 0, reverse=True)
    return {"price_unavailable_reason": None, "articles": all_articles[:limit]}
