import pytest

from app.utils.cron_validation import (
    normalize_schedule_cron,
    parse_cron_trigger,
)


@pytest.mark.unit
def test_normalize_schedule_cron_strips_and_nulls_empty():
    assert normalize_schedule_cron(" 0 9 * * * ") == "0 9 * * *"
    assert normalize_schedule_cron("") is None
    assert normalize_schedule_cron("   ") is None
    assert normalize_schedule_cron(None) is None


@pytest.mark.unit
def test_parse_cron_trigger_accepts_valid_expression():
    trigger = parse_cron_trigger("0 9 * * 1-5")
    assert trigger is not None


@pytest.mark.unit
def test_parse_cron_trigger_rejects_invalid_expression():
    with pytest.raises(ValueError, match="Invalid cron expression"):
        parse_cron_trigger("not a cron")


@pytest.mark.unit
def test_build_watchlist_schedule_specs_skips_invalid_rows():
    from types import SimpleNamespace
    from app.services.scheduler import _build_watchlist_schedule_specs

    items = [
        SimpleNamespace(
            id="good",
            ticker="AAPL",
            schedule_cron="0 9 * * 1-5",
        ),
        SimpleNamespace(
            id="bad",
            ticker="BAD",
            schedule_cron="invalid cron",
        ),
    ]
    specs = _build_watchlist_schedule_specs(items)
    assert len(specs) == 1
    assert specs[0].item_id == "good"
