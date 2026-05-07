"""APScheduler wrapper — fires scheduled watchlist runs and daily portfolio insights."""
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


async def _fire_daily_portfolio_insights() -> None:
    """Generate AI insights for every portfolio that has at least one holding."""
    from sqlalchemy.orm import selectinload as _selectinload
    from app.models.portfolio import Portfolio, PortfolioSnapshot
    from app.models.portfolio_insight import PortfolioInsight, InsightStatus, InsightTrigger
    from app.models.api_key import ApiKey
    from app.services.encryption import decrypt_key
    from app.services.portfolio_insight_runner import generate_portfolio_insight

    async with AsyncSessionLocal() as db:
        # Pick the first available LLM provider key to use for scheduled insights
        providers_in_order = ["openai", "anthropic", "google"]
        llm_provider = None
        llm_model = None
        for prov in providers_in_order:
            row = (await db.execute(select(ApiKey).where(ApiKey.provider == prov))).scalar_one_or_none()
            if row and row.is_valid:
                llm_provider = prov
                # Use a sensible default model per provider
                llm_model = {
                    "openai": "gpt-4o-mini",
                    "anthropic": "claude-haiku-4-5-20251001",
                    "google": "gemini-1.5-flash",
                }[prov]
                break

        if not llm_provider:
            return  # No LLM key configured — skip scheduled insights

        # Find all portfolios that have at least one holding in their latest snapshot
        all_portfolios = (
            await db.execute(select(Portfolio).options(_selectinload(Portfolio.snapshots)))
        ).scalars().all()

        tasks = []
        for portfolio in all_portfolios:
            if not portfolio.snapshots:
                continue

            # Skip if insight already generated in last 12 hours
            existing = (
                await db.execute(
                    select(PortfolioInsight)
                    .where(
                        PortfolioInsight.portfolio_id == portfolio.id,
                        PortfolioInsight.status == InsightStatus.completed,
                    )
                    .order_by(PortfolioInsight.generated_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()

            if existing:
                age_hours = (datetime.now(timezone.utc) - existing.generated_at).total_seconds() / 3600
                if age_hours < 12:
                    continue

            # Skip if one is already running
            in_flight = (
                await db.execute(
                    select(PortfolioInsight).where(
                        PortfolioInsight.portfolio_id == portfolio.id,
                        PortfolioInsight.status.in_([InsightStatus.pending, InsightStatus.running]),
                    )
                )
            ).scalar_one_or_none()
            if in_flight:
                continue

            insight = PortfolioInsight(
                portfolio_id=portfolio.id,
                status=InsightStatus.pending,
                trigger=InsightTrigger.scheduled,
                llm_provider=llm_provider,
                llm_model=llm_model,
            )
            db.add(insight)
            await db.flush()
            tasks.append(str(insight.id))

        await db.commit()

    # Launch generation tasks outside the DB session
    import asyncio
    for insight_id in tasks:
        asyncio.create_task(generate_portfolio_insight(insight_id))


async def start_scheduler() -> AsyncScheduler:
    global _scheduler
    _scheduler = AsyncScheduler()
    await _scheduler.__aenter__()
    await _scheduler.start_in_background()  # actually runs the scheduler loop
    await _reload_jobs(_scheduler)
    # Register daily portfolio insights job (weekdays at 9:15 AM UTC)
    await _scheduler.add_schedule(
        _fire_daily_portfolio_insights,
        CronTrigger(hour=9, minute=15, day_of_week="mon-fri"),
        id="daily_portfolio_insights",
        conflict_policy="replace",
    )
    return _scheduler


async def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        await _scheduler.__aexit__(None, None, None)
        _scheduler = None


async def reload_jobs() -> None:
    if _scheduler:
        await _reload_jobs(_scheduler)
