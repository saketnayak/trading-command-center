"""Net worth: portfolios plus manual assets, liabilities and crypto wallets.

GET    /net-worth?range=                          totals, category split, items, portfolios and a series
POST   /net-worth/items                           add an asset, liability or wallet (with its first value)
PATCH  /net-worth/items/{id}                      rename, recategorise, notes; `value` + `as_of` records a value
DELETE /net-worth/items/{id}
POST   /net-worth/items/{id}/valuations           record (or replace) the value on a date
DELETE /net-worth/items/{id}/valuations/{date}
POST   /net-worth/items/{id}/sync                 re-read a wallet's balance
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.net_worth import NetWorthItem, NetWorthValuation
from app.models.portfolio import Portfolio
from app.models.user import User
from app.services import fx_service, wallet_service
from app.services.net_worth_calc import (
    ASSET_CATEGORIES,
    CATEGORY_LABELS,
    LIABILITY_CATEGORIES,
    MAX_PRICE_GAP_DAYS,
    ItemInput,
    breakdown,
    net_worth_series,
    sample_dates,
)
from app.services.portfolio_performance_service import _range_start, build_performance_report
from app.services.price_history_service import get_closes

router = APIRouter()

MAX_ITEMS = 200
RANGES = ("6m", "ytd", "1y", "3y", "5y")
METHODOLOGY = (
    "Portfolios use their Performance series (actual holdings once there are 30 days of history, otherwise today's "
    "holdings over the range) and count from where that series starts. Other items count from their first recorded "
    "value and hold each value until the next one. Wallets are balance × that day's close. All amounts use today's "
    "FX rates."
)


class ItemIn(BaseModel):
    kind: Literal["asset", "liability"] = "asset"
    category: str = Field(max_length=32)
    name: str = Field(min_length=1, max_length=120)
    currency: str = Field(default="USD", max_length=8)
    value: float | None = Field(default=None, ge=0, le=1e12)
    as_of: date | None = None
    notes: str | None = Field(default=None, max_length=1000)
    wallet_chain: Literal["btc", "eth"] | None = None
    wallet_address: str | None = Field(default=None, max_length=128)


class ItemPatch(BaseModel):
    category: str | None = Field(default=None, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=1000)
    value: float | None = Field(default=None, ge=0, le=1e12)
    as_of: date | None = None


class ValuationIn(BaseModel):
    date: date
    value: float = Field(ge=0, le=1e12)


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _check_category(kind: str, category: str) -> None:
    allowed = LIABILITY_CATEGORIES if kind == "liability" else ASSET_CATEGORIES
    if category not in allowed:
        raise HTTPException(status_code=422, detail=f"Category must be one of: {', '.join(allowed)}")


async def _own_item(db: AsyncSession, item_id: UUID, user: User) -> NetWorthItem:
    item = (await db.execute(select(NetWorthItem).where(NetWorthItem.id == item_id, NetWorthItem.user_id == user.id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


async def _record(db: AsyncSession, item_id: UUID, day: date, value: float) -> None:
    stmt = insert(NetWorthValuation).values(item_id=item_id, date=day, value=value)
    await db.execute(stmt.on_conflict_do_update(index_elements=["item_id", "date"], set_={"value": value}))


async def _factor(currency: str, display: str) -> float:
    src = (currency or "USD").upper()
    if src == display:
        return 1.0
    to = await fx_service.get_rate(display)
    frm = await fx_service.get_rate(src) if src in fx_service.SUPPORTED_CURRENCIES else 1.0
    return to / frm if frm else 1.0


@router.get("/net-worth")
async def net_worth(range: str = Query(default="1y"), db: AsyncSession = Depends(get_db),  # noqa: A002
                    user: User = Depends(get_current_user)):
    if range not in RANGES:
        raise HTTPException(status_code=422, detail=f"range must be one of {', '.join(RANGES)}")
    ccy = (user.preferred_currency or "USD").upper()
    today = _today()
    start = _range_start(range, today)
    warnings: list[str] = []

    # Portfolios, through the same series as the Performance tab.
    portfolios = (await db.execute(select(Portfolio).where(Portfolio.user_id == user.id).order_by(Portfolio.name))).scalars().all()
    p_series: dict[str, dict[date, float]] = {}
    p_rows = []
    for p in portfolios:
        rep = await build_performance_report(db, p.id, display_currency=ccy, mode="auto", range_key=range)
        series = {date.fromisoformat(pt["date"]): pt["value"] for pt in rep.get("series") or [] if pt.get("value") is not None}
        if series:
            p_series[str(p.id)] = series
        p_rows.append({"id": str(p.id), "name": p.name, "value": series[max(series)] if series else 0.0,
                       "mode": rep.get("mode"), "start": rep.get("start"), "holdings_source": rep.get("holdings_source")})
        for w in rep.get("warnings") or []:
            if w.startswith(("No price history for", "Could not refresh")) and not w.startswith("No price history for benchmark"):
                warnings.append(f"{p.name}: {w}")

    # Manual items and wallets.
    items = (await db.execute(select(NetWorthItem).where(NetWorthItem.user_id == user.id).order_by(NetWorthItem.created_at))).scalars().all()
    vals: dict[UUID, list[tuple[date, float]]] = {i.id: [] for i in items}
    if items:
        for v in (await db.execute(select(NetWorthValuation).where(NetWorthValuation.item_id.in_(list(vals)))
                                   .order_by(NetWorthValuation.date))).scalars():
            vals[v.item_id].append((v.date, v.value))
    chains = sorted({i.wallet_chain for i in items if i.wallet_chain})
    coin_closes: dict[str, dict[date, float]] = {}
    if chains:
        symbols = [wallet_service.CHAINS[c] for c in chains]
        closes, _ = await get_closes(db, symbols, start - timedelta(days=MAX_PRICE_GAP_DAYS + 7), today)
        coin_closes = {c: closes.get(wallet_service.CHAINS[c], {}) for c in chains}
        for c in chains:
            if not coin_closes[c]:
                warnings.append(f"No {c.upper()} price: those wallets are left out.")
    usd_factor = await _factor("USD", ccy)

    inputs: list[ItemInput] = []
    for i in items:
        if i.wallet_chain:
            inputs.append(ItemInput(str(i.id), "asset", i.category, i.name, vals[i.id], usd_factor, coin_closes.get(i.wallet_chain, {})))
        else:
            inputs.append(ItemInput(str(i.id), i.kind, i.category, i.name, vals[i.id], await _factor(i.currency, ccy)))

    item_rows = []
    today_values = []
    for i, inp in zip(items, inputs):
        latest = vals[i.id][-1] if vals[i.id] else None
        value_display = inp.value_on(today)
        today_values.append((inp, value_display))
        item_rows.append({
            "id": str(i.id), "kind": i.kind, "category": i.category, "category_label": CATEGORY_LABELS.get(i.category, i.category),
            "name": i.name, "currency": "USD" if i.wallet_chain else i.currency, "notes": i.notes,
            "value": None if i.wallet_chain or latest is None else round(latest[1], 2),
            "balance": latest[1] if i.wallet_chain and latest else None,
            "as_of": latest[0].isoformat() if latest else None,
            "first_date": vals[i.id][0][0].isoformat() if vals[i.id] else None,
            "value_display": round(value_display, 2) if value_display is not None else None,
            "wallet_chain": i.wallet_chain, "wallet_address": i.wallet_address,
            "synced_at": i.synced_at.isoformat() if i.synced_at else None, "sync_error": i.sync_error,
            "valuations": [{"date": d.isoformat(), "value": v} for d, v in vals[i.id][-24:]],
            "stale": bool(latest and not i.wallet_chain and (today - latest[0]).days > 180),
        })

    observed = sorted({d for s in p_series.values() for d in s})
    dates = sample_dates(start, today, observed, weekly=range in ("3y", "5y"))
    series = net_worth_series(dates, p_series, inputs)
    summary = breakdown({r["id"]: r["value"] for r in p_rows if r["value"]}, today_values)
    first = next((pt for pt in series if pt["net_worth"] != 0), None)
    change = None
    if first and series:
        diff = series[-1]["net_worth"] - first["net_worth"]
        change = {"since": first["date"], "amount": round(diff, 2),
                  "pct": round(diff / abs(first["net_worth"]), 6) if first["net_worth"] else None}
    stale = [r["name"] for r in item_rows if r["stale"]]
    if stale:
        warnings.append("Not updated in over 6 months: " + ", ".join(stale) + ".")

    return {
        "display_currency": ccy, "range": range, "start": dates[0].isoformat(), "end": today.isoformat(),
        **summary, "change": change, "portfolios": p_rows, "items": item_rows, "series": series,
        "categories": {"asset": [{"id": c, "label": CATEGORY_LABELS[c]} for c in ASSET_CATEGORIES],
                       "liability": [{"id": c, "label": CATEGORY_LABELS[c]} for c in LIABILITY_CATEGORIES]},
        "warnings": warnings, "methodology": METHODOLOGY,
    }


@router.post("/net-worth/items", status_code=status.HTTP_201_CREATED)
async def add_item(body: ItemIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    count = (await db.execute(select(func.count()).select_from(NetWorthItem).where(NetWorthItem.user_id == user.id))).scalar_one()
    if count >= MAX_ITEMS:
        raise HTTPException(status_code=409, detail=f"You can track up to {MAX_ITEMS} items.")
    if body.wallet_chain:
        address = (body.wallet_address or "").strip()
        if not wallet_service.valid_address(body.wallet_chain, address):
            raise HTTPException(status_code=422, detail=f"That doesn't look like a {body.wallet_chain.upper()} address.")
        item = NetWorthItem(user_id=user.id, kind="asset", category="crypto_wallet", name=body.name.strip(),
                            currency="USD", notes=body.notes, wallet_chain=body.wallet_chain, wallet_address=address)
        db.add(item)
        await db.flush()
        await wallet_service.sync_wallet(db, item)
    else:
        _check_category(body.kind, body.category)
        if body.category == "crypto_wallet":
            raise HTTPException(status_code=422, detail="A crypto wallet needs a chain and a public address.")
        if body.value is None:
            raise HTTPException(status_code=422, detail="Enter the current value.")
        currency = body.currency.strip().upper() or "USD"
        if currency not in fx_service.SUPPORTED_CURRENCIES:
            raise HTTPException(status_code=422, detail=f"Currency must be one of: {', '.join(sorted(fx_service.SUPPORTED_CURRENCIES))}")
        item = NetWorthItem(user_id=user.id, kind=body.kind, category=body.category, name=body.name.strip(),
                            currency=currency, notes=body.notes)
        db.add(item)
        await db.flush()
        await _record(db, item.id, body.as_of or _today(), body.value)
    await db.commit()
    return {"id": str(item.id), "sync_error": item.sync_error}


@router.patch("/net-worth/items/{item_id}")
async def update_item(item_id: UUID, body: ItemPatch, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await _own_item(db, item_id, user)
    if body.category is not None and not item.wallet_chain:
        _check_category(item.kind, body.category)
        if body.category == "crypto_wallet":
            raise HTTPException(status_code=422, detail="A crypto wallet needs a chain and a public address.")
        item.category = body.category
    if body.name is not None:
        item.name = body.name.strip()
    if "notes" in body.model_fields_set:
        item.notes = body.notes
    if body.value is not None:
        if item.wallet_chain:
            raise HTTPException(status_code=422, detail="A wallet's balance comes from its address; use sync instead.")
        await _record(db, item.id, body.as_of or _today(), body.value)
    await db.commit()
    return {"id": str(item.id)}


@router.delete("/net-worth/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await _own_item(db, item_id, user)
    await db.delete(item)
    await db.commit()


@router.post("/net-worth/items/{item_id}/valuations")
async def add_valuation(item_id: UUID, body: ValuationIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await _own_item(db, item_id, user)
    if item.wallet_chain:
        raise HTTPException(status_code=422, detail="A wallet's balance comes from its address; use sync instead.")
    if body.date > _today():
        raise HTTPException(status_code=422, detail="The date can't be in the future.")
    await _record(db, item.id, body.date, body.value)
    await db.commit()
    return {"date": body.date.isoformat(), "value": body.value}


@router.delete("/net-worth/items/{item_id}/valuations/{day}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_valuation(item_id: UUID, day: date, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await _own_item(db, item_id, user)
    count = (await db.execute(select(func.count()).select_from(NetWorthValuation).where(NetWorthValuation.item_id == item.id))).scalar_one()
    if count <= 1:
        raise HTTPException(status_code=409, detail="An item needs at least one value; delete the item instead.")
    result = await db.execute(delete(NetWorthValuation).where(NetWorthValuation.item_id == item.id, NetWorthValuation.date == day))
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="No value on that date")
    await db.commit()


@router.post("/net-worth/items/{item_id}/sync")
async def sync_item(item_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await _own_item(db, item_id, user)
    if not item.wallet_chain:
        raise HTTPException(status_code=422, detail="Only crypto wallets sync.")
    ok = await wallet_service.sync_wallet(db, item)
    await db.commit()
    return {"ok": ok, "sync_error": item.sync_error, "synced_at": item.synced_at.isoformat() if item.synced_at else None}
