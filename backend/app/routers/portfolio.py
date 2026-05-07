import csv
import io
import time
from uuid import UUID
from datetime import datetime, timezone
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
from app.models.user import User
from app.models.run import Run, RunStatus
from app.models.api_key import ApiKey
from app.services.encryption import decrypt_key
from app.services.portfolio_parser import parse_portfolio_csv

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


class HoldingResponse(BaseModel):
    ticker: str
    shares: float
    avg_cost: Optional[float]
    currency: str
    current_price: Optional[float]
    market_value: Optional[float]
    unrealized_pnl: Optional[float]
    unrealized_pnl_pct: Optional[float]
    last_run: Optional[LastRun]


class Totals(BaseModel):
    market_value: Optional[float]
    unrealized_pnl: Optional[float]
    unrealized_pnl_pct: Optional[float]


class CurrentResponse(BaseModel):
    snapshot: Optional[PortfolioSnapshotResponse]
    price_unavailable_reason: Optional[str]
    totals: Totals
    holdings: list[HoldingResponse]


# ── AV price helpers ──────────────────────────────────────────────────────────

async def _get_av_key(db: AsyncSession) -> Optional[str]:
    result = await db.execute(select(ApiKey).where(ApiKey.provider == "alpha_vantage"))
    key_row = result.scalar_one_or_none()
    if not key_row or not key_row.is_valid:
        return None
    return decrypt_key(key_row.encrypted_key)


async def _fetch_price(ticker: str, api_key: str) -> Optional[float]:
    now = time.time()
    if ticker in _price_cache:
        price, expiry = _price_cache[ticker]
        if now < expiry:
            return price
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=GLOBAL_QUOTE&symbol={ticker}&apikey={api_key}"
    )
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()
        price_str = data.get("Global Quote", {}).get("05. price")
        price = float(price_str) if price_str else None
    except Exception:
        price = None
    _price_cache[ticker] = (price, now + _CACHE_TTL)
    return price


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

    av_key = await _get_av_key(db)
    price_unavailable_reason: Optional[str] = None
    if not av_key:
        price_unavailable_reason = "no_av_key"

    # Fetch last run verdict per ticker (most recent completed run for this user)
    tickers = [h.ticker for h in snapshot.holdings]
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
                )

    enriched: list[HoldingResponse] = []
    total_market_value: float = 0.0
    total_cost: float = 0.0
    has_price = False

    for h in snapshot.holdings:
        price: Optional[float] = None
        if av_key:
            price = await _fetch_price(h.ticker, av_key)

        market_value: Optional[float] = h.shares * price if price is not None else None
        unrealized_pnl: Optional[float] = None
        unrealized_pnl_pct: Optional[float] = None
        if price is not None and h.avg_cost is not None:
            unrealized_pnl = (price - h.avg_cost) * h.shares
            unrealized_pnl_pct = (price / h.avg_cost - 1) * 100

        if market_value is not None:
            total_market_value += market_value
            has_price = True
        if h.avg_cost is not None:
            total_cost += h.avg_cost * h.shares

        enriched.append(HoldingResponse(
            ticker=h.ticker,
            shares=h.shares,
            avg_cost=h.avg_cost,
            currency=h.currency,
            current_price=price,
            market_value=market_value,
            unrealized_pnl=unrealized_pnl,
            unrealized_pnl_pct=unrealized_pnl_pct,
            last_run=last_runs.get(h.ticker),
        ))

    totals_pnl = (total_market_value - total_cost) if has_price and total_cost else None
    totals_pct = ((total_market_value / total_cost - 1) * 100) if has_price and total_cost else None
    totals = Totals(
        market_value=total_market_value if has_price else None,
        unrealized_pnl=totals_pnl,
        unrealized_pnl_pct=totals_pct,
    )

    return CurrentResponse(
        snapshot=snapshot,
        price_unavailable_reason=price_unavailable_reason,
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

    av_key = await _get_av_key(db)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Ticker", "Shares", "Avg Cost", "Current Price", "Market Value",
                     "Unrealized P&L ($)", "Unrealized P&L (%)", "Last Analysis Verdict", "Last Analysis Date"])

    for h in snapshot.holdings:
        price: Optional[float] = None
        if av_key:
            price = await _fetch_price(h.ticker, av_key)
        market_value = round(h.shares * price, 2) if price is not None else ""
        pnl = round((price - h.avg_cost) * h.shares, 2) if price is not None and h.avg_cost is not None else ""
        pnl_pct = round((price / h.avg_cost - 1) * 100, 2) if price is not None and h.avg_cost is not None else ""

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
            h.avg_cost if h.avg_cost is not None else "",
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
