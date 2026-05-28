from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.watchlist import Watchlist, WatchlistItem
from app.models.user import User
from app.dependencies import get_current_user

router = APIRouter()


_DEFAULT_ANALYSTS = ["market", "social", "news", "fundamentals"]


class WatchlistItemCreate(BaseModel):
    ticker: str
    llm_provider: str
    llm_model: str
    depth: str = "standard"
    analysts: list[str] = _DEFAULT_ANALYSTS
    schedule_cron: str | None = None


class WatchlistItemUpdate(BaseModel):
    schedule_cron: str | None = None
    enabled: bool | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    depth: str | None = None
    analysts: list[str] | None = None


class WatchlistItemResponse(BaseModel):
    id: UUID
    watchlist_id: UUID
    ticker: str
    llm_provider: str
    llm_model: str
    depth: str
    analysts: list[str]
    schedule_cron: str | None
    enabled: bool
    last_run_at: datetime | None
    last_run_id: UUID | None
    next_run_at: datetime | None
    added_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WatchlistResponse(BaseModel):
    id: UUID
    created_by: UUID
    name: str
    items: list[WatchlistItemResponse]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


async def _get_or_create_watchlist(user_id: UUID, db: AsyncSession) -> Watchlist:
    result = await db.execute(
        select(Watchlist)
        .where(Watchlist.created_by == user_id)
        .options(selectinload(Watchlist.items))
    )
    wl = result.scalar_one_or_none()
    if not wl:
        wl = Watchlist(created_by=user_id)
        db.add(wl)
        await db.commit()
        await db.refresh(wl)
        wl.items = []
    return wl


@router.get("/watchlist", response_model=WatchlistResponse)
async def get_watchlist(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await _get_or_create_watchlist(user.id, db)


@router.post("/watchlist/items", response_model=WatchlistItemResponse, status_code=status.HTTP_201_CREATED)
async def add_watchlist_item(
    req: WatchlistItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    wl = await _get_or_create_watchlist(user.id, db)
    existing = await db.execute(
        select(WatchlistItem).where(
            WatchlistItem.watchlist_id == wl.id,
            WatchlistItem.ticker == req.ticker.upper(),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, f"{req.ticker.upper()} already in watchlist")
    from app.utils.asset_type import is_crypto
    from app.utils.tradingagents_analysts import normalize_analysts

    ticker = req.ticker.upper()
    analysts = normalize_analysts(req.analysts, exclude_fundamentals=is_crypto(ticker))
    item = WatchlistItem(
        watchlist_id=wl.id,
        ticker=ticker,
        llm_provider=req.llm_provider,
        llm_model=req.llm_model,
        depth=req.depth,
        analysts=analysts,
        schedule_cron=req.schedule_cron,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    from app.services.scheduler import reload_jobs
    await reload_jobs()
    return item


@router.patch("/watchlist/items/{item_id}", response_model=WatchlistItemResponse)
async def update_watchlist_item(
    item_id: UUID,
    req: WatchlistItemUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = await db.get(WatchlistItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    wl = await db.get(Watchlist, item.watchlist_id)
    if str(wl.created_by) != str(user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized")
    for field, value in req.model_dump(exclude_none=True).items():
        setattr(item, field, value)
    await db.commit()
    await db.refresh(item)
    from app.services.scheduler import reload_jobs
    await reload_jobs()
    return item


@router.delete("/watchlist/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_watchlist_item(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = await db.get(WatchlistItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    wl = await db.get(Watchlist, item.watchlist_id)
    if str(wl.created_by) != str(user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized")
    await db.delete(item)
    await db.commit()
    from app.services.scheduler import reload_jobs
    await reload_jobs()


@router.get("/watchlist/scheduler/jobs")
async def get_scheduler_jobs(_user: User = Depends(get_current_user)):
    """Return currently registered APScheduler job IDs and next run times."""
    from app.services.scheduler import _scheduler
    if not _scheduler:
        return {"running": False, "jobs": []}
    schedules = await _scheduler.get_schedules()
    jobs = [
        {"id": s.id, "next_fire_time": str(s.next_fire_time) if hasattr(s, "next_fire_time") else None}
        for s in schedules if s.id.startswith("wl_")
    ]
    return {"running": True, "state": str(_scheduler._state), "jobs": jobs}


@router.post("/watchlist/items/{item_id}/run", status_code=status.HTTP_201_CREATED)
async def trigger_watchlist_run(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Manually trigger an immediate run for a watchlist item."""
    from datetime import date
    item = await db.get(WatchlistItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    wl = await db.get(Watchlist, item.watchlist_id)
    if str(wl.created_by) != str(user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized")

    from app.models.run import Run
    from app.services.job_manager import start_run
    from app.utils.asset_type import is_crypto as _is_crypto
    from app.utils.tradingagents_analysts import normalize_analysts

    analysts = normalize_analysts(
        item.analysts or _DEFAULT_ANALYSTS,
        exclude_fundamentals=_is_crypto(item.ticker),
    )
    run = Run(
        created_by=user.id,
        ticker=item.ticker,
        analysis_date=date.today(),
        llm_provider=item.llm_provider,
        llm_model=item.llm_model,
        depth=item.depth,
        analysts=analysts,
        label=f"Watchlist: {item.ticker}",
    )
    db.add(run)
    item.last_run_at = datetime.now(timezone.utc)
    item.last_run_id = run.id
    await db.commit()
    await db.refresh(run)
    await start_run(str(run.id), {
        "ticker": run.ticker,
        "analysis_date": str(run.analysis_date),
        "llm_provider": run.llm_provider,
        "llm_model": run.llm_model,
        "depth": run.depth,
        "analysts": run.analysts,
    })
    return {"run_id": str(run.id)}
