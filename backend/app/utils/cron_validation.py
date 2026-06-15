"""Cron expression and timezone validation for watchlist schedules."""
import zoneinfo

from apscheduler.triggers.cron import CronTrigger

DEFAULT_SCHEDULE_TIMEZONE = "UTC"


def normalize_schedule_cron(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def validate_schedule_timezone(value: str | None) -> str:
    tz_name = (value or DEFAULT_SCHEDULE_TIMEZONE).strip() or DEFAULT_SCHEDULE_TIMEZONE
    try:
        zoneinfo.ZoneInfo(tz_name)
    except Exception as exc:
        raise ValueError(f"Invalid timezone: {tz_name!r}") from exc
    return tz_name


def parse_cron_trigger(
    cron: str,
    timezone_name: str = DEFAULT_SCHEDULE_TIMEZONE,
) -> CronTrigger:
    normalized = normalize_schedule_cron(cron)
    if normalized is None:
        raise ValueError("Cron expression is required")
    tz = zoneinfo.ZoneInfo(validate_schedule_timezone(timezone_name))
    try:
        return CronTrigger.from_crontab(normalized, timezone=tz)
    except Exception as exc:
        raise ValueError(f"Invalid cron expression: {normalized!r}") from exc
