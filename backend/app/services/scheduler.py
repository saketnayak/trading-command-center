"""APScheduler wrapper — fires scheduled watchlist runs and daily portfolio insights."""
import logging
import zoneinfo
from dataclasses import dataclass
from datetime import datetime, timezone

from apscheduler import AsyncScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.run import Run, RunStatus
from app.models.watchlist import WatchlistItem, Watchlist
from app.services.job_manager import start_run
from app.utils.cron_validation import normalize_schedule_cron, parse_cron_trigger

logger = logging.getLogger(__name__)

_scheduler: AsyncScheduler | None = None


async def _get_watchlist_next_fire_time(item_id: str) -> datetime | None:
    if not _scheduler:
        return None
    schedule_id = f"wl_{item_id}"
    for schedule in await _scheduler.get_schedules():
        if schedule.id == schedule_id:
            return schedule.next_fire_time
    return None


def _is_nine_am_in_timezone(tz_name: str) -> bool:
    """Returns True if the current local hour is 9 AM in the given IANA timezone."""
    try:
        return datetime.now(zoneinfo.ZoneInfo(tz_name)).hour == 9
    except Exception:
        return datetime.now(timezone.utc).hour == 9


@dataclass(frozen=True)
class _WatchlistScheduleSpec:
    item_id: str
    cron: str


async def _fire_watchlist_item(item_id: str) -> None:
    try:
        async with AsyncSessionLocal() as db:
            item = await db.get(WatchlistItem, item_id)
            if not item or not item.enabled or not item.schedule_cron:
                return

            wl = await db.get(Watchlist, item.watchlist_id)
            if not wl:
                logger.warning("Watchlist missing for scheduled item %s", item_id)
                return

            item.next_run_at = await _get_watchlist_next_fire_time(str(item.id))

            in_flight = (
                await db.execute(
                    select(Run)
                    .where(
                        Run.created_by == wl.created_by,
                        Run.ticker == item.ticker,
                        Run.status.in_([RunStatus.pending, RunStatus.running]),
                    )
                    .order_by(Run.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if in_flight:
                logger.info(
                    "Skipping scheduled run for %s — run %s still %s",
                    item.ticker,
                    in_flight.id,
                    in_flight.status.value,
                )
                await db.commit()
                return

            from app.utils.asset_type import is_crypto
            from app.utils.tradingagents_analysts import normalize_analysts

            analysts = normalize_analysts(
                item.analysts or ["market", "social", "news", "fundamentals"],
                exclude_fundamentals=is_crypto(item.ticker),
            )
            run = Run(
                created_by=wl.created_by,
                ticker=item.ticker,
                analysis_date=datetime.now().date(),
                llm_provider=item.llm_provider,
                llm_model=item.llm_model,
                depth=item.depth,
                analysts=analysts,
                response_language=item.response_language,
                label=f"Scheduled: {item.ticker}",
            )
            db.add(run)
            await db.flush()
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
    except Exception:
        logger.exception("Scheduled watchlist run failed for item %s", item_id)


def _build_watchlist_schedule_specs(items: list[WatchlistItem]) -> list[_WatchlistScheduleSpec]:
    specs: list[_WatchlistScheduleSpec] = []
    for item in items:
        cron = normalize_schedule_cron(item.schedule_cron)
        if not cron:
            continue
        try:
            parse_cron_trigger(cron)
        except ValueError as exc:
            logger.warning(
                "Skipping watchlist item %s (%s): %s",
                item.id,
                item.ticker,
                exc,
            )
            continue
        specs.append(_WatchlistScheduleSpec(str(item.id), cron))
    return specs


async def _sync_next_run_times(db, scheduler: AsyncScheduler) -> None:
    fire_times = {
        schedule.id[3:]: schedule.next_fire_time
        for schedule in await scheduler.get_schedules()
        if schedule.id.startswith("wl_")
    }
    all_items = (await db.execute(select(WatchlistItem))).scalars().all()
    for item in all_items:
        item.next_run_at = fire_times.get(str(item.id))


async def _reload_jobs(scheduler: AsyncScheduler) -> None:
    """Remove all watchlist jobs and re-add from DB. Invalid rows are skipped without wiping valid schedules."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(WatchlistItem)
            .options(selectinload(WatchlistItem.watchlist))
            .where(WatchlistItem.enabled == True, WatchlistItem.schedule_cron.isnot(None))  # noqa: E712
        )
        items = result.scalars().all()
        specs = _build_watchlist_schedule_specs(items)

    for job in await scheduler.get_schedules():
        if job.id.startswith("wl_"):
            await scheduler.remove_schedule(job.id)

    for spec in specs:
        trigger = parse_cron_trigger(spec.cron)
        await scheduler.add_schedule(
            _fire_watchlist_item,
            trigger,
            id=f"wl_{spec.item_id}",
            args=[spec.item_id],
            conflict_policy="replace",
        )

    async with AsyncSessionLocal() as db:
        await _sync_next_run_times(db, scheduler)
        await db.commit()


async def _fire_daily_portfolio_insights() -> None:
    """Generate AI insights for portfolios where it is currently 9 AM in their delivery timezone."""
    import asyncio
    from sqlalchemy.orm import selectinload as _selectinload
    from app.models.portfolio import Portfolio
    from app.models.portfolio_delivery_settings import PortfolioDeliverySettings
    from app.models.portfolio_insight import PortfolioInsight, InsightStatus, InsightTrigger
    from app.models.api_key import ApiKey
    from app.models.user import User
    from app.services.portfolio_insight_runner import generate_portfolio_insight
    from app.utils.llm_providers import DEFAULT_LLM_MODELS, resolve_llm_model

    async def _pick_llm_for_user(db, user: User | None) -> tuple[str, str] | None:
        providers_in_order = list(DEFAULT_LLM_MODELS.keys())
        if user:
            row = (
                await db.execute(select(ApiKey).where(ApiKey.provider == user.default_llm_provider))
            ).scalar_one_or_none()
            if row and row.is_valid:
                return user.default_llm_provider, resolve_llm_model(
                    user.default_llm_provider,
                    user.default_llm_model,
                )
        for prov in providers_in_order:
            row = (await db.execute(select(ApiKey).where(ApiKey.provider == prov))).scalar_one_or_none()
            if row and row.is_valid:
                return prov, DEFAULT_LLM_MODELS[prov]
        return None

    async with AsyncSessionLocal() as db:
        all_portfolios = (
            await db.execute(select(Portfolio).options(_selectinload(Portfolio.snapshots)))
        ).scalars().all()

        tasks = []
        for portfolio in all_portfolios:
            if not portfolio.snapshots or not any(s.row_count > 0 for s in portfolio.snapshots):
                continue

            owner = await db.get(User, portfolio.user_id)
            llm_choice = await _pick_llm_for_user(db, owner)
            if not llm_choice:
                continue
            llm_provider, llm_model = llm_choice

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


def get_scheduler_state() -> dict:
    """Return scheduler health for diagnostics endpoints."""
    if not _scheduler:
        return {"running": False, "jobs": []}
    return {"running": True, "state": str(_scheduler.state)}
