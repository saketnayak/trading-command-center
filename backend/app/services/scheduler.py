"""Minimal APScheduler wrapper — fires scheduled watchlist runs."""
from datetime import date, datetime, timezone
from apscheduler import AsyncScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import AsyncSessionLocal
from app.models.watchlist import WatchlistItem, Watchlist
from app.models.run import Run
from app.services.job_manager import start_run

_scheduler: AsyncScheduler | None = None


async def _fire_watchlist_item(item_id: str) -> None:
    async with AsyncSessionLocal() as db:
        item = await db.get(WatchlistItem, item_id)
        if not item or not item.enabled:
            return
        wl = await db.get(Watchlist, item.watchlist_id)
        run = Run(
            created_by=wl.created_by,
            ticker=item.ticker,
            analysis_date=date.today(),
            llm_provider=item.llm_provider,
            llm_model=item.llm_model,
            depth=item.depth,
            analysts=item.analysts,
            label=f"Scheduled: {item.ticker}",
        )
        db.add(run)
        item.last_run_at = datetime.now(timezone.utc)
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


async def _reload_jobs(scheduler: AsyncScheduler) -> None:
    """Remove all watchlist jobs and re-add from DB."""
    for job in await scheduler.get_schedules():
        if job.id.startswith("wl_"):
            await scheduler.remove_schedule(job.id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(WatchlistItem)
            .options(selectinload(WatchlistItem.watchlist))
            .where(WatchlistItem.enabled == True, WatchlistItem.schedule_cron.isnot(None))  # noqa: E712
        )
        items = result.scalars().all()
        for item in items:
            await scheduler.add_schedule(
                _fire_watchlist_item,
                CronTrigger.from_crontab(item.schedule_cron),
                id=f"wl_{item.id}",
                args=[str(item.id)],
                conflict_policy="replace",
            )


async def start_scheduler() -> AsyncScheduler:
    global _scheduler
    _scheduler = AsyncScheduler()
    await _scheduler.__aenter__()
    await _scheduler.start_in_background()  # actually runs the scheduler loop
    await _reload_jobs(_scheduler)
    return _scheduler


async def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        await _scheduler.__aexit__(None, None, None)
        _scheduler = None


async def reload_jobs() -> None:
    if _scheduler:
        await _reload_jobs(_scheduler)
