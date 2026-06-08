import pytest
from types import SimpleNamespace

from app.services.tradingagents_grounding import (
    apply_analyst_specific_grounding_patch,
    has_analyst_tool_evidence,
)

pytestmark = pytest.mark.unit


def test_has_analyst_tool_evidence_matches_tool_name():
    messages = [
        SimpleNamespace(type="tool", name="get_stock_data"),
        SimpleNamespace(type="tool", name="get_fundamentals"),
    ]

    assert has_analyst_tool_evidence(messages, {"get_fundamentals"})
    assert not has_analyst_tool_evidence(messages, {"get_balance_sheet"})


def test_grounding_patch_rejects_other_analyst_tool_evidence():
    apply_analyst_specific_grounding_patch()

    from tradingagents.agents.utils import content as content_module

    report = content_module.analyst_report_or_evidence_warning(
        analyst_name="Fundamentals Analyst",
        ticker="AMZN",
        trade_date="2026-05-31",
        messages=[SimpleNamespace(type="tool", name="get_stock_data")],
        tool_calls=[],
        content="Ungrounded fundamentals text.",
    )

    assert report.startswith("[TOOL_ERROR]")
    assert "relevant tool result" in report


def test_grounding_patch_accepts_current_analyst_tool_evidence():
    apply_analyst_specific_grounding_patch()

    from tradingagents.agents.utils import content as content_module

    report = content_module.analyst_report_or_evidence_warning(
        analyst_name="Fundamentals Analyst",
        ticker="AMZN",
        trade_date="2026-05-31",
        messages=[SimpleNamespace(type="tool", name="get_fundamentals")],
        tool_calls=[],
        content="Grounded fundamentals text.",
    )

    assert report == "Grounded fundamentals text."
