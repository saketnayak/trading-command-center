"""Scheduler integration tests for watchlist cron registration."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import zoneinfo

from app.models.run import Run, RunStatus
from app.models.watchlist import Watchlist, WatchlistItem
from app.services.scheduler import _fire_watchlist_item, _reload_jobs
from app.utils.cron_validation import parse_cron_trigger


@pytest.mark.unit
def test_cron_trigger_next_fire_matches_schedule_time():
    """30 8 * * 1-5 should fire at 08:30 in the scheduler/server timezone."""
    trigger = parse_cron_trigger("30 8 * * 1-5")
    first = trigger.next()
    assert first is not None
    assert first.hour == 8
    assert first.minute == 30
    assert first.weekday() < 5  # Mon-Fri


@pytest.mark.unit
def test_cron_trigger_weekday_interval_steps_by_one_day():
    trigger = parse_cron_trigger("0 9 * * 1-5")
    first = trigger.next()
    second = next(iter(trigger))
    assert first is not None and second is not None
    delta_days = (second.date() - first.date()).days
    assert delta_days == 1


@pytest.mark.asyncio
async def test_reload_jobs_registers_cron_triggers():
    item = SimpleNamespace(
        id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        ticker="AAPL",
        schedule_cron="30 8 * * 1-5",
        enabled=True,
        watchlist=SimpleNamespace(),
    )

    mock_scheduler = AsyncMock()
    mock_scheduler.get_schedules.return_value = []

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [item]

    mock_db = AsyncMock()
    mock_db.execute.return_value = mock_result
    mock_db.commit = AsyncMock()

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_db
    mock_cm.__aexit__.return_value = None

    with patch("app.services.scheduler.AsyncSessionLocal", return_value=mock_cm):
        await _reload_jobs(mock_scheduler)

    mock_scheduler.remove_schedule.assert_not_called()
    mock_scheduler.add_schedule.assert_awaited_once()
    args, kwargs = mock_scheduler.add_schedule.await_args
    registered_trigger = args[1]
    assert kwargs["id"] == f"wl_{item.id}"
    assert kwargs["args"] == [item.id]

    expected = parse_cron_trigger(item.schedule_cron)
    assert registered_trigger.next().replace(microsecond=0) == expected.next().replace(microsecond=0)


@pytest.mark.asyncio
async def test_reload_jobs_syncs_next_run_at_from_scheduler():
    item_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    item = SimpleNamespace(
        id=item_id,
        ticker="MSFT",
        schedule_cron="0 9 * * 1-5",
        enabled=True,
        watchlist=SimpleNamespace(),
        next_run_at=None,
    )
    all_item = SimpleNamespace(
        id=item_id,
        ticker="MSFT",
        schedule_cron="0 9 * * 1-5",
        next_run_at=None,
    )

    next_fire = datetime(2026, 6, 17, 9, 0, tzinfo=zoneinfo.ZoneInfo("UTC"))
    schedule = SimpleNamespace(id=f"wl_{item_id}", next_fire_time=next_fire)

    mock_scheduler = AsyncMock()
    mock_scheduler.get_schedules.side_effect = [
        [],
        [schedule],
    ]

    enabled_result = MagicMock()
    enabled_result.scalars.return_value.all.return_value = [item]

    all_result = MagicMock()
    all_result.scalars.return_value.all.return_value = [all_item]

    mock_db = AsyncMock()
    mock_db.execute.side_effect = [enabled_result, all_result]
    mock_db.commit = AsyncMock()

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_db
    mock_cm.__aexit__.return_value = None

    with patch("app.services.scheduler.AsyncSessionLocal", return_value=mock_cm):
        await _reload_jobs(mock_scheduler)

    assert all_item.next_run_at == next_fire


@pytest.mark.asyncio
async def test_fire_watchlist_item_skips_any_in_flight_user_ticker_run_and_updates_next_run():
    item_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    next_fire = datetime(2026, 6, 17, 9, 0, tzinfo=zoneinfo.ZoneInfo("UTC"))
    item = SimpleNamespace(
        id=item_id,
        enabled=True,
        schedule_cron="0 9 * * 1-5",
        ticker="AAPL",
        watchlist_id="watchlist-id",
        next_run_at=None,
    )
    watchlist = SimpleNamespace(created_by="user-id")
    active_run = SimpleNamespace(id="active-run", status=RunStatus.running)

    async def get_side_effect(model, key):
        if model is WatchlistItem:
            return item
        if model is Watchlist:
            return watchlist
        return None

    in_flight_result = MagicMock()
    in_flight_result.scalar_one_or_none.return_value = active_run

    mock_db = AsyncMock()
    mock_db.get.side_effect = get_side_effect
    mock_db.execute.return_value = in_flight_result
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_db
    mock_cm.__aexit__.return_value = None

    mock_scheduler = AsyncMock()
    mock_scheduler.get_schedules.return_value = [
        SimpleNamespace(id=f"wl_{item_id}", next_fire_time=next_fire)
    ]

    with (
        patch("app.services.scheduler.AsyncSessionLocal", return_value=mock_cm),
        patch("app.services.scheduler._scheduler", mock_scheduler),
        patch("app.services.scheduler.start_run", new=AsyncMock()) as start_run_mock,
    ):
        await _fire_watchlist_item(item_id)

    assert item.next_run_at == next_fire
    mock_db.commit.assert_awaited_once()
    mock_db.add.assert_not_called()
    start_run_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_fire_watchlist_item_flushes_run_before_linking_last_run_id():
    item_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    run_id = UUID("11111111-2222-3333-4444-555555555555")
    next_fire = datetime(2026, 6, 17, 9, 0, tzinfo=zoneinfo.ZoneInfo("UTC"))
    item = SimpleNamespace(
        id=item_id,
        enabled=True,
        schedule_cron="0 9 * * 1-5",
        ticker="MSFT",
        watchlist_id="watchlist-id",
        analysts=["market", "news"],
        llm_provider="openai",
        llm_model="gpt-4o-mini",
        depth="standard",
        response_language="en-US",
        next_run_at=None,
        last_run_at=None,
        last_run_id=None,
    )
    watchlist = SimpleNamespace(created_by="user-id")

    async def get_side_effect(model, key):
        if model is WatchlistItem:
            return item
        if model is Watchlist:
            return watchlist
        return None

    in_flight_result = MagicMock()
    in_flight_result.scalar_one_or_none.return_value = None

    added_runs: list[Run] = []

    def add_side_effect(run: Run) -> None:
        added_runs.append(run)

    async def flush_side_effect() -> None:
        added_runs[0].id = run_id

    mock_db = AsyncMock()
    mock_db.get.side_effect = get_side_effect
    mock_db.execute.return_value = in_flight_result
    mock_db.add = MagicMock(side_effect=add_side_effect)
    mock_db.flush.side_effect = flush_side_effect
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_db
    mock_cm.__aexit__.return_value = None

    mock_scheduler = AsyncMock()
    mock_scheduler.get_schedules.return_value = [
        SimpleNamespace(id=f"wl_{item_id}", next_fire_time=next_fire)
    ]

    with (
        patch("app.services.scheduler.AsyncSessionLocal", return_value=mock_cm),
        patch("app.services.scheduler._scheduler", mock_scheduler),
        patch("app.services.scheduler.start_run", new=AsyncMock()) as start_run_mock,
    ):
        await _fire_watchlist_item(item_id)

    assert item.next_run_at == next_fire
    assert item.last_run_id == run_id
    mock_db.flush.assert_awaited_once()
    start_run_mock.assert_awaited_once()
    assert start_run_mock.await_args.args[0] == str(run_id)
