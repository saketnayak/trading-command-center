"""Dividend income for a portfolio.

GET /portfolio/{id}/income          forward income, yield, yield on cost, next 12
                                    months' calendar, income received, goal
                                    progress and a reinvestment projection
PUT /portfolio/{id}/income/target   set or clear the monthly income target

Estimates come from each holding's own dividend history (services/income_calc.py);
income received comes from the transaction ledger when the portfolio has one,
otherwise it is estimated from today's shares.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.investor_profile import InvestorProfile
from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.portfolio_transaction import PortfolioTransaction
from app.models.user import User
from app.services import dividend_service, fx_service
from app.services.income_calc import analyse, calendar, projection
from app.services.performance_calc import PriceLookup
from app.services.portfolio_pricing import fx_factors
from app.services.price_history_service import get_closes

router = APIRouter()

METHODOLOGY = (
    "Estimates from each holding's own dividend history (yfinance, per share, by ex-dividend date): frequency from "
    "the gap between payments, forward dividend = the median recent payment × payments per year, next ex-dates "
    "stepped forward from the last one. Amounts use today's shares, the latest close and today's FX rates. Not a "
    "forecast; companies can change or cut dividends at any time."
)


class TargetIn(BaseModel):
    monthly: float | None = Field(default=None, ge=0, le=1e9)


async def _own(db: AsyncSession, portfolio_id: UUID, user: User) -> Portfolio:
    p = (await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


@router.put("/portfolio/{portfolio_id}/income/target")
async def set_income_target(portfolio_id: UUID, body: TargetIn, db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_current_user)):
    p = await _own(db, portfolio_id, user)
    p.income_target_monthly = body.monthly or None
    await db.commit()
    return {"monthly": p.income_target_monthly}


@router.get("/portfolio/{portfolio_id}/income")
async def portfolio_income(portfolio_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    portfolio = await _own(db, portfolio_id, user)
    ccy = (user.preferred_currency or "USD").upper()
    today = datetime.now(timezone.utc).date()
    snap = (await db.execute(select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == portfolio_id)
                             .options(selectinload(PortfolioSnapshot.holdings))
                             .order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1))).scalar_one_or_none()

    shares: dict[str, float] = defaultdict(float)
    cost_sum: dict[str, float] = defaultdict(float)
    cost_shares: dict[str, float] = defaultdict(float)
    for h in (snap.holdings if snap else []):
        t = h.ticker.strip().upper()
        if (h.shares or 0) <= 0:
            continue
        shares[t] += h.shares
        if h.avg_cost is not None:
            cost_sum[t] += h.avg_cost * h.shares
            cost_shares[t] += h.shares
    symbols = sorted(shares)
    profile = (await db.execute(select(InvestorProfile.income_goal).where(InvestorProfile.user_id == user.id))).scalar_one_or_none()
    base = {"portfolio_id": str(portfolio_id), "display_currency": ccy, "methodology": METHODOLOGY,
            "target_monthly": portfolio.income_target_monthly, "income_goal": profile}
    if not symbols:
        return {**base, "holdings": [], "totals": None, "calendar": [], "received": None, "projection": None,
                "warnings": [], "message": "This portfolio has no holdings yet."}

    closes, price_failed = await get_closes(db, symbols, today - timedelta(days=14), today)
    divs, div_failed = await dividend_service.get_dividends(db, symbols)
    fx, _ = await fx_factors(db, symbols, ccy)

    rows, entries = [], []
    total_value = total_income = total_cost = income_on_cost = 0.0
    growth_weighted = growth_weight = 0.0
    for t in symbols:
        info = analyse(divs.get(t, []), today)
        price = PriceLookup(closes.get(t, {})).at(today) if closes.get(t) else None
        f = fx.get(t, 1.0)
        value = shares[t] * price * f if price is not None else None
        annual = shares[t] * info.forward_per_share * f
        per_payment = annual / info.payments_per_year if info.payments_per_year else 0.0
        avg_cost = cost_sum[t] / cost_shares[t] if cost_shares[t] else None
        if value is not None:
            total_value += value
        total_income += annual
        if avg_cost:
            total_cost += shares[t] * avg_cost * f
            income_on_cost += annual
        if info.growth_5y is not None and annual > 0:
            growth_weighted += info.growth_5y * annual
            growth_weight += annual
        entries.append((t, info, per_payment))
        rows.append({
            "ticker": t, "shares": shares[t], "frequency": info.frequency, "suspended": info.suspended,
            "last_ex_date": info.last_ex_date.isoformat() if info.last_ex_date else None,
            "last_amount": info.last_amount, "ttm_per_share": info.ttm_per_share,
            "forward_per_share": info.forward_per_share, "annual_income": round(annual, 2),
            "yield": round(info.forward_per_share / price, 6) if price and info.forward_per_share else None,
            "yield_on_cost": round(info.forward_per_share / avg_cost, 6) if avg_cost and info.forward_per_share else None,
            "next_ex_date": info.next_ex_dates[0].isoformat() if info.next_ex_dates else None,
            "growth_5y": info.growth_5y, "value": round(value, 2) if value is not None else None,
        })
    rows.sort(key=lambda r: -r["annual_income"])

    received = await _received(db, portfolio, symbols, shares, divs, fx, ccy, today)
    payers = [r for r in rows if r["annual_income"] > 0]
    totals = {
        "annual_income": round(total_income, 2),
        "monthly_income": round(total_income / 12, 2),
        "portfolio_value": round(total_value, 2),
        "yield": round(total_income / total_value, 6) if total_value > 0 else None,
        "yield_on_cost": round(income_on_cost / total_cost, 6) if total_cost > 0 else None,
        "payers": len(payers),
        "holdings": len(rows),
        "growth_5y": round(growth_weighted / growth_weight, 6) if growth_weight else None,
    }
    target = portfolio.income_target_monthly
    if target:
        totals["goal_progress"] = round(totals["monthly_income"] / target, 4)

    warnings = []
    unpriced = sorted(t for t in symbols if not closes.get(t))
    if unpriced:
        warnings.append("No price for " + ", ".join(unpriced) + ": yield and value leave them out.")
    stale = sorted((div_failed | price_failed) & set(symbols))
    if stale:
        warnings.append("Could not refresh data for " + ", ".join(stale) + "; using what is stored.")
    suspended = [r["ticker"] for r in rows if r["suspended"]]
    if suspended:
        warnings.append("No recent dividend from " + ", ".join(suspended) + ": counted as paying nothing.")

    return {
        **base,
        "holdings": rows,
        "totals": totals,
        "calendar": calendar(entries, today),
        "received": received,
        "projection": projection(total_income, total_value, totals["growth_5y"]) if total_income > 0 else None,
        "warnings": warnings,
        "message": None if payers else "None of these holdings pays a regular dividend.",
    }


async def _received(db, portfolio: Portfolio, symbols, shares, divs, fx, ccy, today) -> dict:
    """Dividend income by month for the last 24 months: actual cash from the ledger when the
    portfolio has one, otherwise an estimate from today's shares × each ex-date's dividend."""
    start = today.replace(day=1) - timedelta(days=730)
    months: dict[str, float] = defaultdict(float)
    if portfolio.holdings_source == "ledger":
        target_rate = await fx_service.get_rate(ccy)
        rows = (await db.execute(select(PortfolioTransaction).where(
            PortfolioTransaction.portfolio_id == portfolio.id, PortfolioTransaction.type == "DIVIDEND",
            PortfolioTransaction.trade_date >= start))).scalars().all()
        for r in rows:
            local = await fx_service.get_rate(r.currency) if r.currency in fx_service.SUPPORTED_CURRENCIES else 1.0
            months[f"{r.trade_date:%Y-%m}"] += r.amount * (target_rate / local if local else 1.0)
        source = "ledger"
    else:
        for t in symbols:
            for d, a in divs.get(t, []):
                if start <= d <= today:
                    months[f"{d:%Y-%m}"] += shares[t] * a * fx.get(t, 1.0)
        source = "estimate"
    last12 = sum(v for k, v in months.items() if k > f"{today - timedelta(days=365):%Y-%m}")
    return {
        "source": source,
        "by_month": [{"month": k, "amount": round(v, 2)} for k, v in sorted(months.items())],
        "last_12_months": round(last12, 2),
    }
