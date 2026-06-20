"""Runtime compatibility patches for TradingAgents.

Patch 1 — Analyst grounding: TradingAgents marks analyst sections unavailable
when the model writes a final report before any tool output is observed.
Upstream currently treats any prior ToolMessage as evidence, which can let one
analyst appear grounded by another analyst's tools. This patch tightens the
check to the current analyst's tool set.

Patch 2 — OpenAI-compatible reasoning_effort: Groq, IONOS, vLLM, and LiteLLM
can expose an OpenAI-compatible API but reject the `reasoning_effort` parameter
that langchain-openai forwards. When OPENAI_BASE_URL is set to a non-native
OpenAI endpoint we strip that kwarg from _apply_reasoning so the request
succeeds.
"""

import os
from typing import Any

_PATCHED = False
_REASONING_PATCHED = False

_ANALYST_NAME_TO_KEY = {
    "Market Analyst": "market",
    "News Sentiment Analyst": "social",
    "Social Media Analyst": "social",
    "News Analyst": "news",
    "Fundamentals Analyst": "fundamentals",
}


def _tool_message_name(message: Any) -> str | None:
    if getattr(message, "type", None) != "tool" and message.__class__.__name__ != "ToolMessage":
        return None
    name = getattr(message, "name", None)
    return str(name) if name else None


def has_analyst_tool_evidence(messages: list[Any], tool_names: set[str]) -> bool:
    """Return whether messages include a ToolMessage from the analyst's tools."""
    for message in messages:
        if _tool_message_name(message) in tool_names:
            return True
    return False


def _tool_names_for_analyst(analyst_name: str) -> set[str] | None:
    analyst_key = _ANALYST_NAME_TO_KEY.get(analyst_name)
    if not analyst_key:
        return None

    from tradingagents.agents.utils.tool_registry import get_analyst_tools

    return {tool.name for tool in get_analyst_tools(analyst_key)}


def _build_grounding_guard():
    from tradingagents.agents.utils import content as content_module

    def analyst_report_or_evidence_warning(  # noqa: PLR0913
        *,
        analyst_name: str,
        ticker: str,
        trade_date: str,
        messages: list[Any],
        tool_calls: object,
        content: object,
    ) -> str:
        """Return report only when grounded by the current analyst's tools."""
        if tool_calls:
            return ""

        report = content_module.flatten_message_content(content)
        tool_names = _tool_names_for_analyst(analyst_name)
        if tool_names is None:
            if content_module.has_tool_evidence(messages):
                return report
        elif has_analyst_tool_evidence(messages, tool_names):
            return report

        return (
            f"[TOOL_ERROR] {analyst_name} produced a final report before any relevant "
            f"tool result was observed for {ticker} as of {trade_date}. This analyst "
            "section is intentionally marked unavailable because the report was "
            "not grounded in reproducible tool evidence."
        )

    return analyst_report_or_evidence_warning


def apply_analyst_specific_grounding_patch() -> None:
    """Patch TradingAgents analyst grounding to require analyst-owned tools."""
    global _PATCHED
    if _PATCHED:
        return

    from tradingagents.agents.utils import content as content_module

    patched_guard = _build_grounding_guard()
    content_module.analyst_report_or_evidence_warning = patched_guard

    # Analyst modules import the guard directly, so update those module globals
    # as well. Importing these modules is safe and keeps future graph setup using
    # the same patched function.
    from tradingagents.agents.analysts import fundamentals_analyst
    from tradingagents.agents.analysts import market_analyst
    from tradingagents.agents.analysts import news_analyst
    from tradingagents.agents.analysts import social_media_analyst

    fundamentals_analyst.analyst_report_or_evidence_warning = patched_guard
    market_analyst.analyst_report_or_evidence_warning = patched_guard
    news_analyst.analyst_report_or_evidence_warning = patched_guard
    social_media_analyst.analyst_report_or_evidence_warning = patched_guard

    _PATCHED = True


_NATIVE_OPENAI_URL_FRAGMENTS = ("api.openai.com",)


def apply_reasoning_effort_patch() -> None:
    """Patch _apply_reasoning to skip reasoning_effort for non-native OpenAI endpoints.

    Non-native OpenAI-compatible endpoints may reject reasoning_effort. We
    detect them via OPENAI_BASE_URL at runtime so the guard is evaluated
    per-request when the env var is already set.
    """
    global _REASONING_PATCHED
    if _REASONING_PATCHED:
        return

    import tradingagents.llm as llm_module

    original_apply_reasoning = llm_module._apply_reasoning

    def _patched_apply_reasoning(provider, effort, kwargs):
        if provider == "openai":
            base_url = os.environ.get("OPENAI_BASE_URL", "")
            if base_url and not any(fragment in base_url for fragment in _NATIVE_OPENAI_URL_FRAGMENTS):
                return
        original_apply_reasoning(provider, effort, kwargs)

    llm_module._apply_reasoning = _patched_apply_reasoning
    _REASONING_PATCHED = True
