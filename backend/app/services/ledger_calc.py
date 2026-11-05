"""Transaction ledger maths: replay transactions into lots, positions, realised
gains, income and cash. Pure, no I/O.

Transaction types
  BUY / SELL      symbol, quantity > 0, price >= 0, fees >= 0 (fees add to the
                  cost basis of a buy and reduce the proceeds of a sale)
  SPLIT           symbol, quantity = ratio (2 for a 2-for-1, 0.1 for 1-for-10)
  DIVIDEND        amount > 0 (cash received; symbol optional)
  INTEREST        amount > 0
  FEE             amount > 0 (a standalone charge)
  DEPOSIT /
  WITHDRAWAL      amount > 0 (money in / out of the account)

Cost-basis methods: fifo, hifo (highest cost first) and average (pooled
average cost; quantities still leave oldest-first, so holding periods
follow FIFO). Holding period: long term when a lot was held for more than
365 days (US convention; informational, not tax advice).

The account is cash-only for positions: a sale of more than is held only
realises what was held and reports a warning; it never opens a short.
Amounts stay in each transaction's own currency; totals are grouped by
currency rather than converted.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

TxType = Literal["BUY", "SELL", "SPLIT", "DIVIDEND", "INTEREST", "FEE", "DEPOSIT", "WITHDRAWAL"]
Method = Literal["fifo", "hifo", "average"]
TRADE_TYPES = ("BUY", "SELL")
CASH_TYPES = ("DIVIDEND", "INTEREST", "FEE", "DEPOSIT", "WITHDRAWAL")
ALL_TYPES = ("BUY", "SELL", "SPLIT", "DIVIDEND", "INTEREST", "FEE", "DEPOSIT", "WITHDRAWAL")
LONG_TERM_DAYS = 365
QTY_EPS = 1e-9


class TxError(ValueError):
    pass


@dataclass(frozen=True)
class Tx:
    seq: int  # tie-break for same-day ordering (insertion order)
    date: date
    type: str
    symbol: str | None = None
    quantity: float = 0.0
    price: float = 0.0
    amount: float = 0.0
    fees: float = 0.0
    account: str = "Main"
    currency: str = "USD"
    id: str | None = None


def validate(tx: Tx) -> None:
    """Raise TxError when the fields don't fit the type."""
    if tx.type not in ALL_TYPES:
        raise TxError(f"Unknown type '{tx.type}'")
    if tx.type in ("BUY", "SELL", "SPLIT") and not tx.symbol:
        raise TxError(f"{tx.type} needs a symbol")
    if tx.type in TRADE_TYPES:
        if not (tx.quantity > 0):
            raise TxError(f"{tx.type} needs a quantity above 0")
        if tx.price < 0 or tx.fees < 0:
            raise TxError("Price and fees cannot be negative")
    if tx.type == "SPLIT" and not (tx.quantity > 0):
        raise TxError("SPLIT needs a ratio above 0 in quantity (2 for a 2-for-1)")
    if tx.type in CASH_TYPES and not (tx.amount > 0):
        raise TxError(f"{tx.type} needs an amount above 0")
    if any(not math.isfinite(x) for x in (tx.quantity, tx.price, tx.amount, tx.fees)):
        raise TxError("Numbers must be finite")


@dataclass
class Lot:
    open_date: date
    quantity: float
    cost_per_share: float  # includes the buy's fees
    tx_id: str | None = None  # the BUY that opened it (wash-sale matching)


@dataclass
class Realised:
    date: date
    account: str
    symbol: str
    currency: str
    quantity: float
    proceeds: float  # after sale fees
    cost: float
    open_date: date
    open_tx_id: str | None = None  # the BUY the shares came from
    sell_tx_id: str | None = None  # the SELL that closed them

    @property
    def gain(self) -> float:
        return self.proceeds - self.cost

    @property
    def term(self) -> str:
        return "long" if (self.date - self.open_date).days > LONG_TERM_DAYS else "short"


@dataclass
class LedgerState:
    lots: dict[tuple[str, str], list[Lot]] = field(default_factory=dict)  # (account, symbol) → open lots
    currency_of: dict[str, str] = field(default_factory=dict)  # symbol → its trade currency
    realised: list[Realised] = field(default_factory=list)
    income: list[dict] = field(default_factory=list)  # dividends and interest
    fees: dict[str, float] = field(default_factory=lambda: defaultdict(float))  # currency → standalone + trade fees
    cash: dict[tuple[str, str], float] = field(default_factory=lambda: defaultdict(float))  # (account, currency)
    contributions: dict[tuple[str, str], float] = field(default_factory=lambda: defaultdict(float))
    cash_tracked: bool = False
    warnings: list[str] = field(default_factory=list)


def _order(txs: list[Tx]) -> list[Tx]:
    return sorted(txs, key=lambda t: (t.date, t.seq))


def _take(lots: list[Lot], qty: float, method: Method) -> list[tuple[Lot, float]]:
    """Choose which lots a sale draws from: [(lot, quantity taken)]."""
    order = sorted(lots, key=lambda lot: -lot.cost_per_share) if method == "hifo" else list(lots)
    out, left = [], qty
    for lot in order:
        if left <= QTY_EPS:
            break
        q = min(lot.quantity, left)
        out.append((lot, q))
        left -= q
    return out


def _average(lots: list[Lot]) -> None:
    qty = sum(lot.quantity for lot in lots)
    if qty > QTY_EPS:
        avg = sum(lot.quantity * lot.cost_per_share for lot in lots) / qty
        for lot in lots:
            lot.cost_per_share = avg


def replay(txs: list[Tx], method: Method = "fifo") -> LedgerState:
    st = LedgerState()
    for tx in _order(txs):
        acct, ccy = tx.account or "Main", (tx.currency or "USD").upper()
        if tx.type == "DEPOSIT":
            st.cash[(acct, ccy)] += tx.amount
            st.contributions[(acct, ccy)] += tx.amount
            st.cash_tracked = True
        elif tx.type == "WITHDRAWAL":
            st.cash[(acct, ccy)] -= tx.amount
            st.contributions[(acct, ccy)] -= tx.amount
            st.cash_tracked = True
        elif tx.type in ("DIVIDEND", "INTEREST"):
            st.cash[(acct, ccy)] += tx.amount
            st.income.append({"date": tx.date, "type": tx.type, "symbol": tx.symbol, "account": acct,
                              "currency": ccy, "amount": tx.amount})
        elif tx.type == "FEE":
            st.cash[(acct, ccy)] -= tx.amount
            st.fees[ccy] += tx.amount
        elif tx.type == "SPLIT":
            for (a, s), lots in st.lots.items():
                if s == tx.symbol:
                    for lot in lots:
                        lot.quantity *= tx.quantity
                        lot.cost_per_share /= tx.quantity
        elif tx.type == "BUY":
            key = (acct, tx.symbol)
            st.currency_of[tx.symbol] = ccy
            st.lots.setdefault(key, []).append(
                Lot(tx.date, tx.quantity, (tx.quantity * tx.price + tx.fees) / tx.quantity, tx.id)
            )
            if method == "average":
                _average(st.lots[key])
            st.cash[(acct, ccy)] -= tx.quantity * tx.price + tx.fees
            st.fees[ccy] += tx.fees
        elif tx.type == "SELL":
            key = (acct, tx.symbol)
            lots = st.lots.get(key, [])
            held = sum(lot.quantity for lot in lots)
            qty = tx.quantity
            if qty > held + QTY_EPS:
                st.warnings.append(
                    f"{tx.date.isoformat()}: sold {qty:g} {tx.symbol} in {acct} but only {held:g} were held; "
                    "only the held quantity counts (no short positions)."
                )
                qty = held
            st.currency_of.setdefault(tx.symbol, ccy)
            if qty > QTY_EPS:
                gross = qty * tx.price
                fee_share = tx.fees * (qty / tx.quantity)
                for lot, q in _take(lots, qty, method):
                    st.realised.append(Realised(
                        tx.date, acct, tx.symbol, ccy, q,
                        proceeds=(gross - fee_share) * q / qty,
                        cost=q * lot.cost_per_share,
                        open_date=lot.open_date,
                        open_tx_id=lot.tx_id,
                        sell_tx_id=tx.id,
                    ))
                    lot.quantity -= q
                st.lots[key] = [lot for lot in lots if lot.quantity > QTY_EPS]
            st.cash[(acct, ccy)] += tx.quantity * tx.price - tx.fees
            st.fees[ccy] += tx.fees
    return st


def positions(st: LedgerState) -> list[dict]:
    """Open positions aggregated across accounts, with per-account lots."""
    by_symbol: dict[str, dict] = {}
    for (acct, sym), lots in st.lots.items():
        if not lots:
            continue
        p = by_symbol.setdefault(sym, {"symbol": sym, "currency": st.currency_of.get(sym, "USD"),
                                       "quantity": 0.0, "cost": 0.0, "lots": []})
        for lot in lots:
            p["quantity"] += lot.quantity
            p["cost"] += lot.quantity * lot.cost_per_share
            p["lots"].append({"account": acct, "open_date": lot.open_date.isoformat(),
                              "quantity": round(lot.quantity, 10), "cost_per_share": round(lot.cost_per_share, 6)})
    out = []
    for p in by_symbol.values():
        if p["quantity"] <= QTY_EPS:
            continue
        p["avg_cost"] = round(p["cost"] / p["quantity"], 6)
        p["quantity"] = round(p["quantity"], 10)
        p["cost"] = round(p["cost"], 2)
        p["lots"].sort(key=lambda lot: lot["open_date"])
        out.append(p)
    out.sort(key=lambda p: p["symbol"])
    return out


def holdings_timeline(txs: list[Tx]) -> list[tuple[date, dict[str, float]]]:
    """Shares per symbol (all accounts) after each trading day's transactions.
    Feeds performance_calc.HoldingsPeriod: the holdings apply from that date."""
    shares: dict[str, float] = defaultdict(float)
    out: list[tuple[date, dict[str, float]]] = []
    for tx in _order(txs):
        if tx.type == "BUY":
            shares[tx.symbol] += tx.quantity
        elif tx.type == "SELL":
            shares[tx.symbol] = max(0.0, shares[tx.symbol] - tx.quantity)
        elif tx.type == "SPLIT":
            shares[tx.symbol] *= tx.quantity
        else:
            continue
        snapshot = {s: q for s, q in shares.items() if q > QTY_EPS}
        if out and out[-1][0] == tx.date:
            out[-1] = (tx.date, snapshot)
        else:
            out.append((tx.date, snapshot))
    return out


def summary(st: LedgerState, today: date | None = None) -> dict:
    """Totals for the UI: realised gains by year/term/currency, income, fees, cash."""
    realised_by: dict[tuple[int, str, str], dict] = {}
    for r in st.realised:
        k = (r.date.year, r.currency, r.term)
        row = realised_by.setdefault(k, {"year": r.date.year, "currency": r.currency, "term": r.term,
                                         "proceeds": 0.0, "cost": 0.0, "gain": 0.0})
        row["proceeds"] += r.proceeds
        row["cost"] += r.cost
        row["gain"] += r.gain
    income_by: dict[tuple[int, str, str], float] = defaultdict(float)
    for i in st.income:
        income_by[(i["date"].year, i["currency"], i["type"])] += i["amount"]
    return {
        "realised": [{**v, "proceeds": round(v["proceeds"], 2), "cost": round(v["cost"], 2), "gain": round(v["gain"], 2)}
                     for _, v in sorted(realised_by.items(), key=lambda kv: (-kv[0][0], kv[0][1], kv[0][2]))],
        "realised_lots": [{
            "date": r.date.isoformat(), "account": r.account, "symbol": r.symbol, "currency": r.currency,
            "quantity": round(r.quantity, 10), "proceeds": round(r.proceeds, 2), "cost": round(r.cost, 2),
            "gain": round(r.gain, 2), "term": r.term, "open_date": r.open_date.isoformat(),
        } for r in sorted(st.realised, key=lambda r: (r.date, r.symbol), reverse=True)],
        "income": [{"year": y, "currency": c, "type": t, "amount": round(a, 2)}
                   for (y, c, t), a in sorted(income_by.items(), key=lambda kv: (-kv[0][0], kv[0][1], kv[0][2]))],
        "fees": {c: round(v, 2) for c, v in st.fees.items() if v},
        "cash": [{"account": a, "currency": c, "balance": round(v, 2)} for (a, c), v in sorted(st.cash.items())],
        "contributions": [{"account": a, "currency": c, "net": round(v, 2)} for (a, c), v in sorted(st.contributions.items())],
        "cash_tracked": st.cash_tracked,
        "warnings": st.warnings,
    }
