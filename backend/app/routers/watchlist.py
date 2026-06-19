from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.watchlist import Watchlist, WatchlistItem
from app.models.user import User
from app.dependencies import get_current_user
from app.utils.response_language import DEFAULT_RESPONSE_LANGUAGE, normalize_response_language
from app.utils.cron_validation import normalize_schedule_cron, parse_cron_trigger
from app.utils.llm_providers import (
    DEFAULT_LLM_DEPTH,
    normalize_llm_depth,
    normalize_llm_provider,
    resolve_llm_model,
)

router = APIRouter()


_DEFAULT_ANALYSTS = ["market", "social", "news", "fundamentals"]


class WatchlistItemCreate(BaseModel):
    ticker: str
    llm_provider: str
    llm_model: str
    depth: str = DEFAULT_LLM_DEPTH
    analysts: list[str] = _DEFAULT_ANALYSTS
    response_language: str = DEFAULT_RESPONSE_LANGUAGE
    schedule_cron: str | None = None

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: str) -> str:
        return normalize_llm_provider(v)

    @field_validator("depth")
    @classmethod
    def validate_depth(cls, v: str) -> str:
        return normalize_llm_depth(v)

    @field_validator("response_language")
    @classmethod
    def validate_response_language(cls, v: str | None) -> str:
        return normalize_response_language(v)

    @field_validator("schedule_cron")
    @classmethod
    def normalize_cron(cls, v: str | None) -> str | None:
        return normalize_schedule_cron(v)

    @model_validator(mode="after")
    def validate_schedule(self) -> "WatchlistItemCreate":
        self.llm_model = resolve_llm_model(self.llm_provider, self.llm_model)
        if self.schedule_cron:
            parse_cron_trigger(self.schedule_cron)
        return self


class WatchlistItemUpdate(BaseModel):
    schedule_cron: str | None = None
    enabled: bool | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    depth: str | None = None
    analysts: list[str] | None = None
    response_language: str | None = None

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return normalize_llm_provider(v)

    @field_validator("depth")
    @classmethod
    def validate_depth(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return normalize_llm_depth(v)

    @field_validator("response_language")
    @classmethod
    def validate_response_language(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return normalize_response_language(v)

    @field_validator("schedule_cron")
    @classmethod
    def normalize_cron(cls, v: str | None) -> str | None:
        return normalize_schedule_cron(v)


class WatchlistItemResponse(BaseModel):
    id: UUID
    watchlist_id: UUID
    ticker: str
    llm_provider: str
    llm_model: str
    depth: str
    analysts: list[str]
    response_language: str
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
        response_language=req.response_language,
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
    updates = req.model_dump(exclude_unset=True)
    if "schedule_cron" in updates:
        cron = updates.get("schedule_cron", item.schedule_cron)
        if cron:
            try:
                parse_cron_trigger(cron)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    for field, value in updates.items():
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
    from app.services.scheduler import _scheduler, get_scheduler_state
    state = get_scheduler_state()
    if not state["running"] or not _scheduler:
        return {"running": False, "jobs": []}
    schedules = await _scheduler.get_schedules()
    jobs = [
        {
            "id": s.id,
            "next_fire_time": s.next_fire_time.isoformat() if s.next_fire_time else None,
        }
        for s in schedules if s.id.startswith("wl_")
    ]
    return {"running": True, "state": state["state"], "jobs": jobs}


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
        response_language=item.response_language,
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
        "response_language": run.response_language,
    })
    return {"run_id": str(run.id)}
