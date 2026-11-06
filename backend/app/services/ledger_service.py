"""DB glue for the transaction ledger: load transactions as ledger_calc.Tx and
keep the portfolio's holdings in step with them.

A portfolio becomes ledger-backed when it has transactions. Then every change
rewrites one derived snapshot (broker="ledger", reused rather than piling up),
so every existing feature (holdings, performance, risk, rebalancing, alerts,
the AI brief, MCP) works unchanged. While ledger-backed, CSV holdings uploads
and inline holding edits are refused, so the two can't drift apart. Going the
other way, a first transaction may not silently replace existing holdings.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.portfolio import Portfolio, PortfolioHolding, PortfolioSnapshot
from app.models.portfolio_transaction import PortfolioTransaction
from app.services.ledger_calc import Tx, positions, replay

LEDGER_BROKER = "ledger"
LEDGER_LOCKED_DETAIL = (
    "This portfolio's holdings come from its transaction ledger. Record a transaction in the "
    "Transactions tab instead (or stop using the ledger there)."
)
REPLACE_HOLDINGS_DETAIL = (
    "This would replace the portfolio's holdings with only what its transactions add up to. "
    "Use \"Start from current holdings\" in the Transactions tab first, or confirm replacing them."
)


def to_tx(row: PortfolioTransaction) -> Tx:
    return Tx(
        seq=row.seq, date=row.trade_date, type=row.type, symbol=row.symbol, quantity=row.quantity,
        price=row.price, amount=row.amount, fees=row.fees, account=row.account, currency=row.currency,
        id=str(row.id), picks=tuple((str(p["buy_id"]), float(p["quantity"])) for p in (row.lots or ())),
    )


async def load_rows(db: AsyncSession, portfolio_id) -> list[PortfolioTransaction]:
    return list((await db.execute(
        select(PortfolioTransaction).where(PortfolioTransaction.portfolio_id == portfolio_id)
        .order_by(PortfolioTransaction.trade_date, PortfolioTransaction.seq)
    )).scalars().all())


async def load_txs(db: AsyncSession, portfolio_id) -> list[Tx]:
    return [to_tx(r) for r in await load_rows(db, portfolio_id)]


async def next_seq(db: AsyncSession, portfolio_id) -> int:
    current = (await db.execute(select(func.max(PortfolioTransaction.seq)).where(
        PortfolioTransaction.portfolio_id == portfolio_id))).scalar_one()
    return (current or 0) + 1


async def ensure_not_ledger_backed(db: AsyncSession, portfolio_id) -> None:
    """Guard for snapshot writes (CSV upload, inline holding edits)."""
    source = (await db.execute(select(Portfolio.holdings_source).where(Portfolio.id == portfolio_id))).scalar_one_or_none()
    if source == "ledger":
        raise HTTPException(status_code=409, detail=LEDGER_LOCKED_DETAIL)


async def _latest_snapshot(db: AsyncSession, portfolio_id) -> PortfolioSnapshot | None:
    return (await db.execute(
        select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings)).order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1)
    )).scalar_one_or_none()


async def ensure_holdings_not_replaced(db: AsyncSession, portfolio: Portfolio) -> None:
    """Guard for a portfolio's first transactions: the ledger knows nothing about
    existing holdings, so they would disappear from the derived snapshot."""
    if portfolio.holdings_source == "ledger":
        return
    latest = await _latest_snapshot(db, portfolio.id)
    if latest is not None and any((h.shares or 0) > 0 for h in latest.holdings):
        raise HTTPException(status_code=409, detail=REPLACE_HOLDINGS_DETAIL)


async def sync_holdings(db: AsyncSession, portfolio: Portfolio, *, discard_derived: bool = False) -> int:
    """Re-derive holdings from the ledger into the ledger snapshot. Returns the
    number of open positions. With no transactions left, the portfolio goes
    back to snapshot-backed and its last holdings stay as they were, unless the
    ledger snapshot is empty or discard_derived is set: then it is dropped, which
    brings back the holdings from before the ledger."""
    txs = await load_txs(db, portfolio.id)
    latest = await _latest_snapshot(db, portfolio.id)
    if not txs:
        portfolio.holdings_source = "snapshot"
        if latest is not None and latest.broker == LEDGER_BROKER and (discard_derived or not latest.holdings):
            await db.delete(latest)
        return 0
    portfolio.holdings_source = "ledger"
    open_positions = positions(replay(txs, portfolio.cost_basis_method or "fifo"))

    now = datetime.now(timezone.utc)
    if latest is not None and latest.broker == LEDGER_BROKER:
        await db.execute(delete(PortfolioHolding).where(PortfolioHolding.snapshot_id == latest.id))
        snap = latest
        snap.uploaded_at = now
    else:
        snap = PortfolioSnapshot(portfolio_id=portfolio.id, broker=LEDGER_BROKER, uploaded_at=now, row_count=0)
        db.add(snap)
        await db.flush()
    for p in open_positions:
        db.add(PortfolioHolding(snapshot_id=snap.id, ticker=p["symbol"], shares=p["quantity"],
                                avg_cost=p["avg_cost"], currency=p["currency"]))
    snap.row_count = len(open_positions)
    return len(open_positions)
