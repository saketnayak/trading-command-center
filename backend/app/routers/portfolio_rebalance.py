"""Target allocation and rebalancing plans.

GET  /portfolio/{id}/targets     the portfolio's target weights and bands
PUT  /portfolio/{id}/targets     replace them (weights must sum to 100%)
GET  /portfolio/{id}/rebalance   drift vs targets plus a trade plan

Prices are the latest stored closes (price_bars), converted to the user's
display currency. The plan is a plan: AgentFloor never places orders.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.portfolio_target import PortfolioTarget
from app.models.user import User
from app.services.alert_rules import TICKER_RE
from app.services.performance_calc import PriceLookup
from app.services.portfolio_pricing import aggregate_shares, fx_factors
from app.services.price_history_service import get_closes
from app.services.rebalance_calc import Position, Target, build_plan, drift
from app.utils.asset_type import is_crypto

router = APIRouter()

MAX_TARGETS = 200
SUM_TOLERANCE = 0.001  # targets must sum to 100% ± 0.1pp
DEFAULT_BAND = 0.05

DISCLAIMER = (
    "A plan, not an order: AgentFloor never trades. Amounts use the latest daily close and today's FX rates, "
    "so real fills will differ. Taxes and fees are not considered."
)


class TargetIn(BaseModel):
    ticker: str
    weight: float = Field(ge=0, le=1)
    band: float = Field(default=DEFAULT_BAND, ge=0.001, le=0.5)


class TargetsIn(BaseModel):
    targets: list[TargetIn] = Field(max_length=MAX_TARGETS)


async def _own_portfolio(db: AsyncSession, portfolio_id: UUID, user: User) -> Portfolio:
    p = (await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


async def _targets(db: AsyncSession, portfolio_id: UUID) -> list[PortfolioTarget]:
    return list((await db.execute(
        select(PortfolioTarget).where(PortfolioTarget.portfolio_id == portfolio_id).order_by(desc(PortfolioTarget.weight))
    )).scalars().all())


def _target_dict(t: PortfolioTarget) -> dict:
    return {"ticker": t.ticker, "weight": t.weight, "band": t.band}


@router.get("/portfolio/{portfolio_id}/targets")
async def get_targets(portfolio_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _own_portfolio(db, portfolio_id, user)
    rows = await _targets(db, portfolio_id)
    return {"targets": [_target_dict(t) for t in rows], "default_band": DEFAULT_BAND}


@router.put("/portfolio/{portfolio_id}/targets")
async def put_targets(portfolio_id: UUID, body: TargetsIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    await _own_portfolio(db, portfolio_id, user)
    seen: set[str] = set()
    clean: list[TargetIn] = []
    for t in body.targets:
        sym = t.ticker.strip().upper()
        if not TICKER_RE.match(sym):
            raise HTTPException(status_code=422, detail=f"'{t.ticker}' is not a valid ticker")
        if sym in seen:
            raise HTTPException(status_code=422, detail=f"{sym} appears twice")
        seen.add(sym)
        clean.append(TargetIn(ticker=sym, weight=t.weight, band=t.band))
    total = sum(t.weight for t in clean)
    if clean and abs(total - 1.0) > SUM_TOLERANCE:
        raise HTTPException(status_code=422, detail=f"Targets must add up to 100% (they add up to {total * 100:.2f}%)")
    await db.execute(delete(PortfolioTarget).where(PortfolioTarget.portfolio_id == portfolio_id))
    for t in clean:
        db.add(PortfolioTarget(portfolio_id=portfolio_id, ticker=t.ticker, weight=t.weight, band=t.band))
    await db.commit()
    return {"targets": [_target_dict(t) for t in await _targets(db, portfolio_id)], "default_band": DEFAULT_BAND}


@router.get("/portfolio/{portfolio_id}/rebalance")
async def rebalance(
    portfolio_id: UUID,
    mode: Literal["full", "bands", "contribute", "withdraw"] = Query("bands"),
    amount: float = Query(0.0, ge=0, le=1e12),
    whole_shares: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _own_portfolio(db, portfolio_id, user)
    if mode in ("contribute", "withdraw") and amount <= 0:
        raise HTTPException(status_code=422, detail="Enter an amount to invest or raise")

    snapshot = (await db.execute(
        select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings)).order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1)
    )).scalar_one_or_none()
    shares = aggregate_shares(snapshot.holdings) if snapshot else {}
    target_rows = await _targets(db, portfolio_id)
    targets = {t.ticker: Target(t.weight, t.band) for t in target_rows}
    display_currency = (user.preferred_currency or "USD").upper()
    base = {"portfolio_id": str(portfolio_id), "display_currency": display_currency, "disclaimer": DISCLAIMER,
            "targets": [_target_dict(t) for t in target_rows]}

    symbols = sorted(set(shares) | set(targets))
    if not symbols:
        return {**base, "warnings": [], "drift": [], "plan": None, "total_value": 0.0,
                "message": "Add holdings or targets to plan a rebalance."}

    today = datetime.now(timezone.utc).date()
    closes, failed = await get_closes(db, symbols, today - timedelta(days=14), today)
    fx, _ = await fx_factors(db, symbols, display_currency)

    positions: dict[str, Position] = {}
    unpriced: list[str] = []
    for s in symbols:
        price = PriceLookup(closes.get(s, {})).at(today) if closes.get(s) else None
        if price is None:
            unpriced.append(s)
            continue
        positions[s] = Position(s, shares.get(s, 0.0), price, fx.get(s, 1.0), fractional=is_crypto(s))

    warnings: list[str] = []
    if unpriced:
        warnings.append("No recent price for " + ", ".join(unpriced) + "; left out of the plan.")
    stale = sorted(s for s in failed if s in positions)
    if stale:
        warnings.append("Could not refresh prices for " + ", ".join(stale) + "; using the last stored close.")
    untargeted = sorted(s for s in shares if s not in targets and s in positions)
    if targets and untargeted:
        warnings.append("No target for " + ", ".join(untargeted) + ": treated as 0%, so a rebalance sells them.")

    priced_targets = {k: v for k, v in targets.items() if k in positions}
    rows = drift(positions, priced_targets, DEFAULT_BAND)
    total = sum(p.value for p in positions.values())
    if not targets:
        return {**base, "warnings": warnings, "drift": rows, "plan": None, "total_value": round(total, 2),
                "message": "Set target weights to get a rebalancing plan."}
    if len(priced_targets) < len(targets):
        scale = sum(t.weight for t in priced_targets.values())
        if scale <= 0:
            return {**base, "warnings": warnings, "drift": rows, "plan": None, "total_value": round(total, 2),
                    "message": "None of the target tickers has a price yet."}
        # Re-normalise over what can be priced, so the plan still invests 100%.
        priced_targets = {k: Target(v.weight / scale, v.band) for k, v in priced_targets.items()}

    plan = build_plan(mode, positions, priced_targets, amount=amount, whole_shares=whole_shares)
    return {**base, "warnings": warnings, "drift": rows, "plan": plan, "total_value": round(total, 2), "message": None}
