"""Rebalancing maths: drift and trade plans. Pure, no I/O.

All amounts are in the display currency. A position's value is shares ×
price × fx; `fx` converts its listing currency to the display currency.

Modes
  full        trade every position to its target (plus optional new cash).
  bands       trade only positions outside their tolerance band back to
              target. In-band positions fund the shortfall (selling their
              excess) or absorb the surplus (buying their deficit) in
              proportion to their distance from target; anything left is
              reported as cash.
  contribute  buy-only: new cash goes to underweight positions in proportion
              to their shortfall against the new total; once every
              shortfall is filled, the excess is spread by target weight.
  withdraw    sell-only: cash comes from overweight positions in proportion
              to their excess; any remainder is taken pro rata by value.

The output is a plan. AgentFloor never places orders.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

Mode = Literal["full", "bands", "contribute", "withdraw"]


@dataclass(frozen=True)
class Position:
    ticker: str
    shares: float
    price: float  # listing currency
    fx: float = 1.0  # listing → display currency
    fractional: bool = True  # False: whole shares when whole_shares is on

    @property
    def unit_value(self) -> float:
        return self.price * self.fx

    @property
    def value(self) -> float:
        return self.shares * self.unit_value


@dataclass(frozen=True)
class Target:
    weight: float  # 0..1
    band: float  # absolute, 0.05 = ±5 percentage points


def _r(x: float | None, p: int = 6) -> float | None:
    return None if x is None or not math.isfinite(x) else round(x, p)


def drift(positions: dict[str, Position], targets: dict[str, Target], default_band: float = 0.05) -> list[dict]:
    """Current vs target weight per ticker (held, targeted, or both)."""
    total = sum(p.value for p in positions.values())
    rows = []
    for t in sorted(set(positions) | set(targets)):
        p = positions.get(t)
        tgt = targets.get(t)
        w = (p.value / total) if p and total > 0 else 0.0
        tw = tgt.weight if tgt else 0.0
        band = tgt.band if tgt else default_band
        d = w - tw
        if tgt is None:
            status = "untargeted"
        elif p is None or p.shares == 0:
            status = "not_held" if tw > 0 else "ok"
        elif abs(d) > band + 1e-12:
            status = "over" if d > 0 else "under"
        else:
            status = "ok"
        rows.append({
            "ticker": t,
            "shares": p.shares if p else 0.0,
            "price": _r(p.price if p else None, 6),
            "value": _r(p.value if p else 0.0, 2),
            "weight": _r(w),
            "target": _r(tw),
            "band": _r(band),
            "drift": _r(d),
            "status": status,
        })
    rows.sort(key=lambda r: -abs(r["drift"] or 0))
    return rows


def _proportional(pool: float, weights: dict[str, float], caps: dict[str, float] | None = None) -> dict[str, float]:
    """Split `pool` by `weights`, never giving anyone more than their cap."""
    out = {k: 0.0 for k in weights}
    remaining = pool
    active = {k for k, w in weights.items() if w > 0}
    while remaining > 1e-9 and active:
        total_w = sum(weights[k] for k in active)
        if total_w <= 0:
            break
        spent = 0.0
        for k in list(active):
            share = remaining * weights[k] / total_w
            if caps is not None:
                room = caps[k] - out[k]
                if share >= room - 1e-12:
                    share = room
                    active.discard(k)
            out[k] += share
            spent += share
        remaining -= spent
        if caps is None:
            break
    return out


def plan_amounts(mode: Mode, positions: dict[str, Position], targets: dict[str, Target],
                 amount: float = 0.0) -> tuple[dict[str, float], float]:
    """Signed trade amounts per ticker (+ buy, − sell) and the cash left over."""
    tickers = sorted(set(positions) | set(targets))
    cur = {t: positions[t].value if t in positions else 0.0 for t in tickers}
    tw = {t: targets[t].weight if t in targets else 0.0 for t in tickers}
    total = sum(cur.values())

    if mode == "full":
        new_total = total + amount
        trades = {t: tw[t] * new_total - cur[t] for t in tickers}
        return trades, 0.0

    if mode == "contribute":
        new_total = total + amount
        deficit = {t: max(0.0, tw[t] * new_total - cur[t]) for t in tickers}
        need = sum(deficit.values())
        if need >= amount:
            buys = _proportional(amount, deficit)
        else:
            extra = _proportional(amount - need, tw)
            buys = {t: deficit[t] + extra.get(t, 0.0) for t in tickers}
        return buys, 0.0

    if mode == "withdraw":
        amount = min(amount, total)
        new_total = total - amount
        excess = {t: max(0.0, cur[t] - tw[t] * new_total) for t in tickers}
        have = sum(excess.values())
        if have >= amount:
            sells = _proportional(amount, excess)
        else:
            rest = {t: cur[t] - excess[t] for t in tickers}
            more = _proportional(amount - have, rest, caps=rest)
            sells = {t: excess[t] + more.get(t, 0.0) for t in tickers}
        return {t: -v for t, v in sells.items()}, 0.0

    # bands
    w = {t: (cur[t] / total if total > 0 else 0.0) for t in tickers}
    band = {t: targets[t].band if t in targets else 0.0 for t in tickers}
    breach = {t for t in tickers if (t not in targets and cur[t] > 0) or abs(w[t] - tw[t]) > band[t] + 1e-12}
    trades = {t: (tw[t] * total - cur[t]) if t in breach else 0.0 for t in tickers}
    net = sum(trades.values())  # > 0: buys exceed sells
    inside = [t for t in tickers if t not in breach]
    leftover = 0.0
    if net > 1e-9:
        excess = {t: max(0.0, cur[t] - tw[t] * total) for t in inside}
        funded = _proportional(min(net, sum(excess.values())), excess, caps=excess)
        for t, v in funded.items():
            trades[t] -= v
        short = net - sum(funded.values())
        if short > 1e-9:  # scale breaching buys down to what is funded
            buys = {t: v for t, v in trades.items() if v > 0 and t in breach}
            total_buys = sum(buys.values())
            for t, v in buys.items():
                trades[t] = v - short * v / total_buys
    elif net < -1e-9:
        deficit = {t: max(0.0, tw[t] * total - cur[t]) for t in inside}
        absorbed = _proportional(min(-net, sum(deficit.values())), deficit, caps=deficit)
        for t, v in absorbed.items():
            trades[t] += v
        leftover = -net - sum(absorbed.values())
    return trades, leftover


def build_plan(mode: Mode, positions: dict[str, Position], targets: dict[str, Target], *,
               amount: float = 0.0, whole_shares: bool = False, min_trade: float | None = None) -> dict:
    """Trades (in money and shares), weights after, and a summary."""
    trades, leftover = plan_amounts(mode, positions, targets, amount)
    total = sum(p.value for p in positions.values())
    floor_amt = min_trade if min_trade is not None else max(1.0, 0.0005 * (total + max(amount, 0.0)))

    rows = []
    after_value = {t: (positions[t].value if t in positions else 0.0) for t in set(positions) | set(targets)}
    for t, amt in trades.items():
        if abs(amt) < floor_amt:
            continue
        pos = positions.get(t)
        unit = pos.unit_value if pos else None
        if not unit:
            continue  # no price: the caller reports it
        shares = amt / unit
        if whole_shares and not pos.fractional:
            # Buys round down and sells round up, so the plan stays funded.
            shares = math.floor(shares) if shares > 0 else -min(math.ceil(-shares), pos.shares)
            if shares == 0:
                continue
            amt = shares * unit
        elif amt < 0:
            shares = max(shares, -pos.shares)
            amt = shares * unit
        rows.append({
            "ticker": t,
            "action": "buy" if amt > 0 else "sell",
            "amount": _r(abs(amt), 2),
            "shares": _r(abs(shares), 6),
            "price": _r(pos.price, 6),
        })
        after_value[t] += amt

    buys = sum(r["amount"] for r in rows if r["action"] == "buy")
    sells = sum(r["amount"] for r in rows if r["action"] == "sell")
    cash_in = amount if mode in ("full", "contribute") else 0.0
    cash_out = min(amount, total) if mode == "withdraw" else 0.0
    cash_left = cash_in + sells - buys - cash_out
    if abs(cash_left) <= 0.005 * len(rows) + 1e-9:
        cash_left = 0.0  # cent rounding of each trade amount, not real cash
    invested_after = sum(after_value.values())

    def max_drift(values: dict[str, float], denom: float) -> float:
        return max((abs((values.get(t, 0.0) / denom if denom > 0 else 0.0) - (targets[t].weight if t in targets else 0.0))
                    for t in values), default=0.0)

    weights_after = {t: (v / invested_after if invested_after > 0 else 0.0) for t, v in after_value.items()}
    for r in rows:
        before = positions[r["ticker"]].value / total if total > 0 else 0.0
        r["weight_before"] = _r(before)
        r["weight_after"] = _r(weights_after[r["ticker"]])
    rows.sort(key=lambda r: (r["action"] != "sell", -r["amount"]))  # sells first: they fund the buys

    return {
        "mode": mode,
        "trades": rows,
        "summary": {
            "trades": len(rows),
            "buys": _r(buys, 2),
            "sells": _r(sells, 2),
            "cash_in": _r(cash_in, 2),
            "cash_out": _r(cash_out, 2),
            "cash_left": _r(cash_left, 2),  # includes bands-mode surplus not reinvested
            "turnover": _r((buys + sells) / 2 / total, 4) if total > 0 else None,
            "max_drift_before": _r(max_drift({t: (positions[t].value if t in positions else 0.0) for t in after_value}, total), 4),
            "max_drift_after": _r(max_drift(after_value, invested_after), 4),
        },
        "weights_after": {t: _r(w) for t, w in sorted(weights_after.items())},
    }
