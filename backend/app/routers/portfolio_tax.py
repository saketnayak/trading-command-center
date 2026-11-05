"""Tax tools for ledger-backed portfolios (informational only, not tax advice).

GET /portfolio/{id}/tax?year=&min_loss=     realised gains for a tax year (Form 8949 layout, wash-sale
                                            adjustments), wash sales, and loss-harvest candidates
GET /portfolio/{id}/tax/replacements?symbol= ETFs that move with a symbol, to keep exposure after a harvest

Wash sales look at BUYs in every portfolio the user owns (see services/tax_calc.py).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import Portfolio
from app.models.portfolio_transaction import PortfolioTransaction
from app.models.user import User
from app.services import ledger_service
from app.services.alert_rules import TICKER_RE
from app.services.ledger_calc import replay
from app.services.performance_calc import PriceLookup
from app.services.portfolio_pricing import fx_factors
from app.services.price_history_service import get_closes
from app.services.tax_calc import (
    REPLACEMENT_POOL,
    BuyRef,
    harvest_candidates,
    replacement_ideas,
    tax_year_report,
    wash_sales,
)

router = APIRouter()

DISCLAIMER = (
    "Informational only, not tax advice. Uses simplified US rules: long term after 365 days held; a loss sale "
    "is a wash sale when the same symbol is bought within 30 days before or after it in any of your portfolios. "
    "Retirement accounts, other brokers, options and \"substantially identical\" securities are not checked. "
    "Check with your broker's 1099-B or a tax professional."
)


async def _own(db: AsyncSession, portfolio_id: UUID, user: User) -> Portfolio:
    p = (await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


async def _all_buys(db: AsyncSession, user: User) -> list[BuyRef]:
    rows = (await db.execute(
        select(PortfolioTransaction, Portfolio.name).join(Portfolio, Portfolio.id == PortfolioTransaction.portfolio_id)
        .where(Portfolio.user_id == user.id, PortfolioTransaction.type == "BUY")
    )).all()
    return [BuyRef(str(t.id), t.trade_date, (t.symbol or "").upper(), t.quantity, t.account or "Main", name)
            for t, name in rows]


@router.get("/portfolio/{portfolio_id}/tax")
async def portfolio_tax(
    portfolio_id: UUID,
    year: int | None = Query(default=None, ge=1990, le=2100),
    min_loss: float = Query(default=100.0, ge=0, le=1e9),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    portfolio = await _own(db, portfolio_id, user)
    today = datetime.now(timezone.utc).date()
    ccy = (user.preferred_currency or "USD").upper()
    base = {"portfolio_id": str(portfolio_id), "display_currency": ccy, "disclaimer": DISCLAIMER,
            "jurisdiction": "US", "cost_basis_method": portfolio.cost_basis_method or "fifo"}
    if portfolio.holdings_source != "ledger":
        return {**base, "available": False, "year": year or today.year, "years": [], "report": None,
                "wash_sales": [], "harvest": [], "warnings": [],
                "message": "Tax tools need the transaction ledger: record or import your trades in the Transactions tab."}

    txs = await ledger_service.load_txs(db, portfolio_id)
    st = replay(txs, portfolio.cost_basis_method or "fifo")
    buys = await _all_buys(db, user)
    wash = wash_sales(st.realised, buys)

    years = sorted({r.date.year for r in st.realised} | {today.year}, reverse=True)
    year = year or today.year
    report = tax_year_report(st.realised, wash, year)
    wash_rows = [row for row in report["rows"] if row["code"] == "W"]

    symbols = sorted({sym for (_, sym), lots in st.lots.items() if lots})
    closes, failed = (await get_closes(db, symbols, today - timedelta(days=14), today)) if symbols else ({}, set())
    prices = {s: PriceLookup(closes[s]).at(today) for s in symbols if closes.get(s)}
    prices = {s: p for s, p in prices.items() if p is not None}
    fx, _ = await fx_factors(db, symbols, ccy) if symbols else ({}, {})
    harvest = harvest_candidates(st.lots, prices, fx, buys, today, min_loss)

    warnings = list(st.warnings)
    unpriced = [s for s in symbols if s not in prices]
    if unpriced:
        warnings.append("No price for " + ", ".join(unpriced) + ": their lots are not checked for losses.")
    stale = sorted(failed & set(symbols))
    if stale:
        warnings.append("Could not refresh prices for " + ", ".join(stale) + "; using the last stored close.")
    if (portfolio.cost_basis_method or "fifo") != "fifo":
        warnings.append("Lots follow your chosen cost-basis method; your broker may report different lots unless "
                        "you elected the same method there.")

    return {
        **base, "available": True, "year": year, "years": years, "report": report,
        "wash_sales": wash_rows, "harvest": harvest, "min_loss": min_loss,
        "warnings": warnings, "message": None,
    }


@router.get("/portfolio/{portfolio_id}/tax/replacements")
async def tax_replacements(
    portfolio_id: UUID,
    symbol: str = Query(..., min_length=1, max_length=20),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _own(db, portfolio_id, user)
    sym = symbol.strip().upper()
    if not TICKER_RE.match(sym):
        raise HTTPException(status_code=422, detail="Invalid ticker")
    today = datetime.now(timezone.utc).date()
    closes, _ = await get_closes(db, [sym, *REPLACEMENT_POOL], today - timedelta(days=366), today)
    ideas = replacement_ideas(sym, closes)
    message = None
    if not closes.get(sym):
        message = f"No price history for {sym}."
    elif not ideas:
        message = "No fund in the replacement list moved with it over the last year (correlation under 0.3)."
    return {"symbol": sym, "ideas": ideas, "message": message,
            "note": "Correlation of daily returns over the last year. Funds tracking the same index as the "
                    "holding are left out; whether two securities are substantially identical is for you and "
                    "your tax adviser to judge."}
