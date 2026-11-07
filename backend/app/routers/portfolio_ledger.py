"""Transaction ledger endpoints (see services/ledger_calc.py and ledger_service.py).

GET    /portfolio/{id}/transactions            list (newest first)
POST   /portfolio/{id}/transactions            add one
PATCH  /portfolio/{id}/transactions/{tx_id}    edit one
DELETE /portfolio/{id}/transactions/{tx_id}    delete one
POST   /portfolio/{id}/transactions/import     validate (dry run) or insert many mapped rows
POST   /portfolio/{id}/ledger/bootstrap        opening BUYs from the current holdings
GET    /portfolio/{id}/ledger                  positions with lots, realised gains, income, fees, cash
PUT    /portfolio/{id}/ledger/settings         cost-basis method
DELETE /portfolio/{id}/ledger                  remove every transaction (back to snapshot holdings)

Every change re-derives the holdings (ledger_service.sync_holdings).
"""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.portfolio_transaction import PortfolioTransaction
from app.models.user import User
from app.services import ledger_service
from app.services.alert_rules import TICKER_RE
from app.services.ledger_calc import ALL_TYPES, Tx, TxError, positions, replay, summary, validate

router = APIRouter()

MAX_IMPORT_ROWS = 5000
TxTypeLit = Literal["BUY", "SELL", "SPLIT", "DIVIDEND", "INTEREST", "FEE", "DEPOSIT", "WITHDRAWAL"]


class LotPick(BaseModel):
    buy_id: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")
    quantity: float = Field(gt=0)

    @field_validator("buy_id")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()  # ledger replay matches lots by the id's canonical (lower-case) form


class TxIn(BaseModel):
    trade_date: date
    type: TxTypeLit
    symbol: str | None = None
    quantity: float = 0.0
    price: float = 0.0
    amount: float = 0.0
    fees: float = 0.0
    account: str = Field(default="Main", max_length=64)
    currency: str = Field(default="USD", max_length=8)
    note: str | None = Field(default=None, max_length=500)
    lots: list[LotPick] | None = Field(default=None, max_length=200)  # SELL only: the lots it closes


class TxPatch(BaseModel):
    trade_date: date | None = None
    type: TxTypeLit | None = None
    symbol: str | None = None
    quantity: float | None = None
    price: float | None = None
    amount: float | None = None
    fees: float | None = None
    account: str | None = Field(default=None, max_length=64)
    currency: str | None = Field(default=None, max_length=8)
    note: str | None = Field(default=None, max_length=500)
    lots: list[LotPick] | None = Field(default=None, max_length=200)


class ImportIn(BaseModel):
    rows: list[dict] = Field(max_length=MAX_IMPORT_ROWS)
    dry_run: bool = True
    replace_holdings: bool = False  # the user accepted losing holdings the ledger doesn't know about


class BootstrapIn(BaseModel):
    trade_date: date
    account: str = Field(default="Main", max_length=64)


class SettingsIn(BaseModel):
    cost_basis_method: Literal["fifo", "hifo", "average"]


async def _own(db: AsyncSession, portfolio_id: UUID, user: User) -> Portfolio:
    p = (await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


def _clean(body: TxIn) -> TxIn:
    """Normalise and validate one transaction, raising TxError with a readable message."""
    sym = body.symbol.strip().upper() if body.symbol and body.symbol.strip() else None
    if sym and not TICKER_RE.match(sym):
        raise TxError(f"'{body.symbol}' is not a valid symbol")
    if body.trade_date > date.today():
        raise TxError("Trade date is in the future")
    out = body.model_copy(update={
        "symbol": sym, "currency": (body.currency or "USD").strip().upper() or "USD",
        "account": (body.account or "Main").strip() or "Main",
        "lots": body.lots or None,
    })
    validate(Tx(0, out.trade_date, out.type, out.symbol, out.quantity, out.price, out.amount, out.fees, out.account,
                out.currency, picks=tuple((p.buy_id, p.quantity) for p in out.lots or ())))
    return out


async def _check_lots(db: AsyncSession, portfolio_id: UUID, tx: TxIn) -> None:
    """Every chosen lot must be a BUY of the same symbol in the same account of this portfolio."""
    if not tx.lots:
        return
    ids = {p.buy_id.lower() for p in tx.lots}
    rows = (await db.execute(select(PortfolioTransaction.id, PortfolioTransaction.type, PortfolioTransaction.symbol,
                                    PortfolioTransaction.account).where(
        PortfolioTransaction.portfolio_id == portfolio_id,
        PortfolioTransaction.id.in_([UUID(i) for i in ids])))).all()
    ok = {str(r.id) for r in rows if r.type == "BUY" and r.symbol == tx.symbol and r.account == tx.account}
    if ok != ids:
        raise TxError(f"A chosen lot isn't a buy of {tx.symbol} in account {tx.account} in this portfolio")


def _tx_dict(r: PortfolioTransaction) -> dict:
    return {"id": str(r.id), "trade_date": r.trade_date.isoformat(), "type": r.type, "symbol": r.symbol,
            "quantity": r.quantity, "price": r.price, "amount": r.amount, "fees": r.fees, "account": r.account,
            "currency": r.currency, "note": r.note, "source": r.source, "seq": r.seq, "lots": r.lots}


async def _check_replays(db: AsyncSession, portfolio: Portfolio) -> list[str]:
    """Replay the whole ledger; returns its warnings (e.g. a sale of more than was held)."""
    return replay(await ledger_service.load_txs(db, portfolio.id), portfolio.cost_basis_method or "fifo").warnings


@router.get("/portfolio/{portfolio_id}/transactions")
async def list_transactions(
    portfolio_id: UUID,
    symbol: str | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _own(db, portfolio_id, user)
    q = select(PortfolioTransaction).where(PortfolioTransaction.portfolio_id == portfolio_id)
    if symbol:
        q = q.where(PortfolioTransaction.symbol == symbol.strip().upper())
    rows = (await db.execute(q.order_by(desc(PortfolioTransaction.trade_date), desc(PortfolioTransaction.seq)).limit(limit))).scalars().all()
    return [_tx_dict(r) for r in rows]


@router.post("/portfolio/{portfolio_id}/transactions", status_code=status.HTTP_201_CREATED)
async def add_transaction(portfolio_id: UUID, body: TxIn, replace_holdings: bool = Query(False),
                          db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    portfolio = await _own(db, portfolio_id, user)
    try:
        clean = _clean(body)
        await _check_lots(db, portfolio_id, clean)
    except TxError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not replace_holdings:
        await ledger_service.ensure_holdings_not_replaced(db, portfolio)
    row = PortfolioTransaction(portfolio_id=portfolio_id, seq=await ledger_service.next_seq(db, portfolio_id),
                               source="manual", **clean.model_dump())
    db.add(row)
    await db.flush()
    await ledger_service.sync_holdings(db, portfolio)
    warnings = await _check_replays(db, portfolio)
    await db.commit()
    await db.refresh(row)
    return {**_tx_dict(row), "warnings": warnings}


@router.patch("/portfolio/{portfolio_id}/transactions/{tx_id}")
async def update_transaction(portfolio_id: UUID, tx_id: UUID, body: TxPatch, db: AsyncSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    portfolio = await _own(db, portfolio_id, user)
    row = (await db.execute(select(PortfolioTransaction).where(
        PortfolioTransaction.id == tx_id, PortfolioTransaction.portfolio_id == portfolio_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    merged = TxIn(**{**{k: getattr(row, k) for k in TxIn.model_fields}, **body.model_dump(exclude_unset=True)})
    try:
        clean = _clean(merged)
        await _check_lots(db, portfolio_id, clean)
    except TxError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    for k, v in clean.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await ledger_service.sync_holdings(db, portfolio)
    warnings = await _check_replays(db, portfolio)
    await db.commit()
    await db.refresh(row)
    return {**_tx_dict(row), "warnings": warnings}


@router.delete("/portfolio/{portfolio_id}/transactions/{tx_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(portfolio_id: UUID, tx_id: UUID, db: AsyncSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    portfolio = await _own(db, portfolio_id, user)
    result = await db.execute(delete(PortfolioTransaction).where(
        PortfolioTransaction.id == tx_id, PortfolioTransaction.portfolio_id == portfolio_id))
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await ledger_service.sync_holdings(db, portfolio, discard_derived=True)  # deleting the last one is an undo
    await db.commit()


@router.get("/portfolio/{portfolio_id}/lots")
async def open_lots(portfolio_id: UUID, symbol: str = Query(..., min_length=1, max_length=32),
                    on: date = Query(...), account: str = Query("Main", max_length=64),
                    exclude: UUID | None = Query(None), db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """The lots of one holding still open on a date, for choosing which ones a sale closes. `exclude` leaves
    out a transaction (the sale being edited)."""
    portfolio = await _own(db, portfolio_id, user)
    sym = symbol.strip().upper()
    txs = [t for t in await ledger_service.load_txs(db, portfolio_id)
           if t.date <= on and (exclude is None or t.id != str(exclude))]
    st = replay(txs, portfolio.cost_basis_method or "fifo")
    lots = st.lots.get(((account or "Main").strip() or "Main", sym), [])
    return {"symbol": sym, "account": account, "on": on.isoformat(), "method": portfolio.cost_basis_method or "fifo",
            "lots": [{"buy_id": lot.tx_id, "open_date": lot.open_date.isoformat(), "quantity": round(lot.quantity, 10),
                      "cost_per_share": round(lot.cost_per_share, 6),
                      "term": "long" if (on - lot.open_date).days > 365 else "short"} for lot in lots]}


@router.post("/portfolio/{portfolio_id}/transactions/import")
async def import_transactions(portfolio_id: UUID, body: ImportIn, db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_current_user)):
    """Rows are already mapped to TxIn fields (the browser parses and maps the CSV).
    A dry run validates every row; a real run inserts all of them or none."""
    portfolio = await _own(db, portfolio_id, user)
    errors: list[dict] = []
    clean: list[TxIn] = []
    for i, raw in enumerate(body.rows):
        try:
            row = _clean(TxIn.model_validate(raw))
            await _check_lots(db, portfolio_id, row)
            clean.append(row)
        except (TxError, ValueError) as exc:  # pydantic ValidationError is a ValueError
            msg = str(exc).splitlines()[0] if not hasattr(exc, "errors") else "; ".join(
                f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('msg')}" for e in exc.errors()[:2])
            errors.append({"row": i + 1, "error": msg})
    preview_warnings: list[str] = []
    if not errors and clean:
        existing = await ledger_service.load_txs(db, portfolio_id)
        start = len(existing) + 1
        trial = existing + [Tx(start + i, t.trade_date, t.type, t.symbol, t.quantity, t.price, t.amount, t.fees,
                               t.account, t.currency, picks=tuple((p.buy_id, p.quantity) for p in t.lots or ()))
                            for i, t in enumerate(clean)]
        preview_warnings = replay(trial, portfolio.cost_basis_method or "fifo").warnings
    if body.dry_run or errors:
        return {"valid": len(clean), "errors": errors, "warnings": preview_warnings, "imported": 0}
    if not body.replace_holdings:
        await ledger_service.ensure_holdings_not_replaced(db, portfolio)
    seq = await ledger_service.next_seq(db, portfolio_id)
    for i, t in enumerate(clean):
        db.add(PortfolioTransaction(portfolio_id=portfolio_id, seq=seq + i, source="csv", **t.model_dump()))
    await db.flush()
    await ledger_service.sync_holdings(db, portfolio)
    await db.commit()
    return {"valid": len(clean), "errors": [], "warnings": preview_warnings, "imported": len(clean)}


@router.post("/portfolio/{portfolio_id}/ledger/bootstrap", status_code=status.HTTP_201_CREATED)
async def bootstrap(portfolio_id: UUID, body: BootstrapIn, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Start the ledger from the current holdings: one opening BUY per holding at its
    average cost on the chosen date. Only for an empty ledger."""
    portfolio = await _own(db, portfolio_id, user)
    if await ledger_service.load_rows(db, portfolio_id):
        raise HTTPException(status_code=409, detail="The ledger already has transactions")
    if body.trade_date > date.today():
        raise HTTPException(status_code=422, detail="Opening date is in the future")
    snap = (await db.execute(select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == portfolio_id)
                             .options(selectinload(PortfolioSnapshot.holdings))
                             .order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1))).scalar_one_or_none()
    holdings = [h for h in (snap.holdings if snap else []) if (h.shares or 0) > 0]
    if not holdings:
        raise HTTPException(status_code=422, detail="There are no holdings to start from")
    missing_cost = sorted(h.ticker for h in holdings if h.avg_cost is None)
    for i, h in enumerate(holdings):
        db.add(PortfolioTransaction(
            portfolio_id=portfolio_id, seq=i + 1, trade_date=body.trade_date, type="BUY", symbol=h.ticker.strip().upper(),
            quantity=h.shares, price=h.avg_cost or 0.0, account=body.account.strip() or "Main",
            currency=(h.currency or "USD").upper(), source="opening",
            note="Opening position from holdings" + ("" if h.avg_cost is not None else " (no average cost: price 0)"),
        ))
    await db.flush()
    count = await ledger_service.sync_holdings(db, portfolio)
    await db.commit()
    return {"created": len(holdings), "positions": count,
            "warnings": [f"No average cost for {', '.join(missing_cost)}: opened at price 0; edit those transactions."]
            if missing_cost else []}


@router.get("/portfolio/{portfolio_id}/ledger")
async def ledger_summary(portfolio_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    portfolio = await _own(db, portfolio_id, user)
    txs = await ledger_service.load_txs(db, portfolio_id)
    method = portfolio.cost_basis_method or "fifo"
    st = replay(txs, method)
    return {
        "holdings_source": portfolio.holdings_source,
        "cost_basis_method": method,
        "transactions": len(txs),
        "first_date": txs[0].date.isoformat() if txs else None,
        "positions": positions(st),
        **summary(st),
    }


@router.put("/portfolio/{portfolio_id}/ledger/settings")
async def ledger_settings(portfolio_id: UUID, body: SettingsIn, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    portfolio = await _own(db, portfolio_id, user)
    portfolio.cost_basis_method = body.cost_basis_method
    await ledger_service.sync_holdings(db, portfolio)  # average costs depend on the method
    await db.commit()
    return {"cost_basis_method": portfolio.cost_basis_method}


@router.delete("/portfolio/{portfolio_id}/ledger", status_code=status.HTTP_204_NO_CONTENT)
async def clear_ledger(portfolio_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Stop using the ledger: delete every transaction. Holdings stay as last derived
    and become editable again."""
    portfolio = await _own(db, portfolio_id, user)
    await db.execute(delete(PortfolioTransaction).where(PortfolioTransaction.portfolio_id == portfolio_id))
    await ledger_service.sync_holdings(db, portfolio)
    await db.commit()


assert set(ALL_TYPES) == set(TxTypeLit.__args__)  # keep the API's literal in step with the engine
