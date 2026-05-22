"""APScheduler wrapper — fires scheduled watchlist runs and daily portfolio insights."""
import zoneinfo
from datetime import date, datetime, timezone
from apscheduler import AsyncScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import AsyncSessionLocal
from app.models.watchlist import WatchlistItem, Watchlist
from app.models.run import Run
from app.services.job_manager import start_run
from app.utils.asset_type import is_crypto


def _is_nine_am_in_timezone(tz_name: str) -> bool:
    """Returns True if the current local hour is 9 AM in the given IANA timezone."""
    try:
        return datetime.now(zoneinfo.ZoneInfo(tz_name)).hour == 9
    except Exception:
        return datetime.now(timezone.utc).hour == 9


def _crypto_safe_analysts(ticker: str, analysts: list[str]) -> list[str]:
    """Remove fundamentals analyst for crypto tickers — it has no meaningful data."""
    if is_crypto(ticker):
        return [a for a in analysts if a != "fundamentals"]
    return analysts

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
            analysts=_crypto_safe_analysts(item.ticker, item.analysts or ["market", "social", "news", "fundamentals", "technical"]),
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
    """Generate AI insights for portfolios where it is currently 9 AM in their delivery timezone."""
    import asyncio
    from sqlalchemy.orm import selectinload as _selectinload
    from app.models.portfolio import Portfolio
    from app.models.portfolio_delivery_settings import PortfolioDeliverySettings
    from app.models.portfolio_insight import PortfolioInsight, InsightStatus, InsightTrigger
    from app.models.api_key import ApiKey
    from app.services.portfolio_insight_runner import generate_portfolio_insight

    async with AsyncSessionLocal() as db:
        # Pick the first available LLM provider key
        providers_in_order = ["openai", "anthropic", "google", "groq"]
        llm_provider = None
        llm_model = None
        for prov in providers_in_order:
            row = (await db.execute(select(ApiKey).where(ApiKey.provider == prov))).scalar_one_or_none()
            if row and row.is_valid:
                llm_provider = prov
                llm_model = {
                    "openai": "gpt-4o-mini",
                    "anthropic": "claude-haiku-4-5-20251001",
                    "google": "gemini-2.5-flash",
                    "groq": "llama-3.3-70b-versatile",
                }[prov]
                break

        if not llm_provider:
            return

        all_portfolios = (
            await db.execute(select(Portfolio).options(_selectinload(Portfolio.snapshots)))
        ).scalars().all()

        tasks = []
        for portfolio in all_portfolios:
            if not portfolio.snapshots or not any(s.row_count > 0 for s in portfolio.snapshots):
                continue

            # Determine delivery timezone: use the portfolio's setting or default to UTC
            ds = (
                await db.execute(
                    select(PortfolioDeliverySettings).where(
                        PortfolioDeliverySettings.portfolio_id == portfolio.id
                    )
                )
            ).scalar_one_or_none()
            tz_name = (ds.delivery_timezone if ds else None) or "UTC"

            # Only fire during the 9 AM hour in the portfolio's timezone
            if not _is_nine_am_in_timezone(tz_name):
                continue

            # Skip if insight already generated in last 12 hours (dedup guard)
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

    for insight_id in tasks:
        asyncio.create_task(generate_portfolio_insight(insight_id))


async def start_scheduler() -> AsyncScheduler:
    global _scheduler
    _scheduler = AsyncScheduler()
    await _scheduler.__aenter__()
    await _scheduler.start_in_background()  # actually runs the scheduler loop
    await _reload_jobs(_scheduler)
    # Run every weekday hour at :15 — each portfolio fires when it's 9 AM in its delivery timezone
    await _scheduler.add_schedule(
        _fire_daily_portfolio_insights,
        CronTrigger(minute=15, day_of_week="mon-fri"),
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
