"""Upstream TradingAgents analyst keys and normalization for AgentFloor."""

SUPPORTED_ANALYSTS: tuple[str, ...] = ("market", "social", "news", "fundamentals")
DEFAULT_ANALYSTS: list[str] = list(SUPPORTED_ANALYSTS)

# Legacy AgentFloor key; upstream folds technical analysis into market analyst.
_LEGACY_ANALYST_ALIASES: dict[str, str] = {
    "technical": "market",
}


def normalize_analysts(
    analysts: list[str] | None,
    *,
    exclude_fundamentals: bool = False,
) -> list[str]:
    """Return deduplicated upstream-supported analysts, preserving order."""
    if not analysts:
        base = list(DEFAULT_ANALYSTS)
    else:
        base = []
        for raw in analysts:
            key = (raw or "").strip().lower()
            if not key:
                continue
            key = _LEGACY_ANALYST_ALIASES.get(key, key)
            if key not in SUPPORTED_ANALYSTS:
                continue
            if key not in base:
                base.append(key)

    if exclude_fundamentals:
        base = [a for a in base if a != "fundamentals"]

    if not base:
        fallback = list(DEFAULT_ANALYSTS)
        if exclude_fundamentals:
            fallback = [a for a in fallback if a != "fundamentals"]
        return fallback

    return base
