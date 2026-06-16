"""Cron expression validation for watchlist schedules."""

from apscheduler.triggers.cron import CronTrigger


def normalize_schedule_cron(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def parse_cron_trigger(cron: str) -> CronTrigger:
    normalized = normalize_schedule_cron(cron)
    if normalized is None:
        raise ValueError("Cron expression is required")
    try:
        return CronTrigger.from_crontab(normalized)
    except Exception as exc:
        raise ValueError(f"Invalid cron expression: {normalized!r}") from exc
