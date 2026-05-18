"""Assembles portfolio context and calls the LLM for conversational chat."""
import asyncio
import uuid
from datetime import date
from typing import Optional

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.portfolio import Portfolio, PortfolioSnapshot, PortfolioHolding
from app.models.portfolio_insight import PortfolioInsight, InsightStatus
from app.models.run import Run, RunStatus
from app.services.portfolio_insight_runner import (
    _call_llm,
    _fetch_sector,
    _get_api_key,
    _serialize_investor_profile,
)

_FINNHUB_CONCURRENCY = asyncio.Semaphore(5)


SYSTEM_PROMPT_TEMPLATE = """You are a personal portfolio advisor for a specific investor. Answer their questions based ONLY on their actual portfolio data shown below. Be direct, specific, and concise. Do not give generic advice — always reference their specific tickers, weights, and verdicts.

Portfolio: {portfolio_name}
Total market value: {total_value}
Total unrealized P&L: {total_pnl}
Number of holdings: {holding_count}
{profile_block}
Holdings:
{holdings_text}

Sector breakdown:
{sector_text}

{insight_block}

Rules:
- Only analyze the portfolio shown above — do not hallucinate positions they don't hold
- When uncertain about external market data, say so — don't fabricate prices or news
- Be direct and opinionated, not wishy-washy
- Keep responses under 400 words unless asked for detail"""

_MAX_HISTORY_TURNS = 10


def _format_holdings(enriched: list[dict]) -> str:
    rows = []
    for h in enriched:
        pnl_str = f"{h['unrealized_pnl_pct']:+.1f}%" if h["unrealized_pnl_pct"] is not None else "N/A"
        price_str = f"${h['current_price']:.2f}" if h["current_price"] else "N/A"
        value_str = f"${h['market_value']:.2f}" if h["market_value"] else "N/A"
        weight_str = f"{h['weight_pct']:.1f}%" if h["weight_pct"] is not None else "N/A"
        verdict = h.get("last_verdict") or "none"
        days = h.get("days_since_analysis")
        analysis_str = f"{verdict} ({days}d ago)" if days is not None else "no analysis"
        rows.append(
            f"  - {h['ticker']} | sector: {h['sector']} | shares: {h['shares']} | "
            f"avg_cost: ${h['avg_cost'] or 'N/A'} | price: {price_str} | "
            f"value: {value_str} | weight: {weight_str} | P&L: {pnl_str} | analysis: {analysis_str}"
        )
    return "\n".join(rows) if rows else "  (no holdings)"


def _format_sectors(enriched: list[dict], total_market_value: float) -> str:
    sector_totals: dict[str, float] = {}
    for h in enriched:
        if h["market_value"] and total_market_value > 0:
            sector_totals[h["sector"]] = sector_totals.get(h["sector"], 0.0) + h["market_value"]
    lines = []
    for sector, val in sorted(sector_totals.items(), key=lambda x: x[1], reverse=True):
        pct = val / total_market_value * 100 if total_market_value else 0
        lines.append(f"  - {sector}: {pct:.1f}%")
    return "\n".join(lines) if lines else "  (unknown)"


def _format_insight_block(insight: Optional[PortfolioInsight]) -> str:
    if not insight or insight.health_score is None:
        return "Latest AI insight: none available"
    lines = [
        f"Latest AI insight (health score: {insight.health_score}/10, stance: {insight.overall_stance}):",
    ]
    if insight.summary:
        lines.append(f"  Summary: {insight.summary[:300]}")
    action_items = (insight.action_items or [])[:3]
    if action_items:
        lines.append("  Top action items:")
        for item in action_items:
            lines.append(f"    - {item.get('ticker')} {item.get('action')} ({item.get('priority')}): {item.get('rationale', '')[:120]}")
    risk_alerts = (insight.risk_alerts or [])[:3]
    if risk_alerts:
        lines.append("  Top risk alerts:")
        for alert in risk_alerts:
            tickers = ", ".join(alert.get("affected_tickers", []))
            lines.append(f"    - [{alert.get('severity')}] {alert.get('description', '')[:120]} ({tickers})")
    return "\n".join(lines)


def _build_conversation_prompt(system_prompt: str, conversation_history: list[dict], new_message: str) -> str:
    """Serialize conversation history into a single prompt string."""
    max_msgs = _MAX_HISTORY_TURNS * 2
    capped = conversation_history[-max_msgs:] if len(conversation_history) > max_msgs else conversation_history

    parts = [system_prompt, ""]
    for msg in capped:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            parts.append(f"User: {content}")
        elif role == "assistant":
            parts.append(f"Assistant: {content}")

    parts.append(f"User: {new_message}")
    parts.append("Assistant:")
    return "\n".join(parts)


async def generate_chat_response(
    portfolio_id: uuid.UUID,
    message: str,
    conversation_history: list[dict],
    llm_provider: str,
    llm_model: str,
    db: AsyncSession,
) -> str:
    portfolio = await db.get(Portfolio, portfolio_id)
    if not portfolio:
        raise ValueError("Portfolio not found")

    snap_result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .options(selectinload(PortfolioSnapshot.holdings))
        .order_by(desc(PortfolioSnapshot.uploaded_at))
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    holdings = snapshot.holdings if snapshot else []
    tickers = [h.ticker for h in holdings]

    from app.models.investor_profile import InvestorProfile as InvestorProfileModel
    profile_result = await db.execute(
        select(InvestorProfileModel).where(InvestorProfileModel.user_id == portfolio.user_id)
    )
    investor_profile = profile_result.scalar_one_or_none()

    insight_result = await db.execute(
        select(PortfolioInsight)
        .where(
            PortfolioInsight.portfolio_id == portfolio_id,
            PortfolioInsight.status == InsightStatus.completed,
        )
        .order_by(desc(PortfolioInsight.generated_at))
        .limit(1)
    )
    latest_insight = insight_result.scalar_one_or_none()

    from app.routers.portfolio import _fetch_prices_bulk, _get_finnhub_key

    finnhub_key = await _get_finnhub_key(db)
    llm_api_key = await _get_api_key(llm_provider, db)

    if tickers:
        async def _bounded_sector(t: str) -> str:
            async with _FINNHUB_CONCURRENCY:
                return await _fetch_sector(t, finnhub_key)

        price_map, sectors = await asyncio.gather(
            _fetch_prices_bulk(tickers, finnhub_key),
            asyncio.gather(*[_bounded_sector(t) for t in tickers]),
        )
        sector_map: dict[str, str] = dict(zip(tickers, sectors))
    else:
        price_map = {}
        sector_map = {}

    today = date.today()
    last_verdicts: dict[str, tuple[str, int]] = {}
    if tickers:
        runs_result = await db.execute(
            select(Run)
            .where(
                Run.created_by == portfolio.user_id,
                Run.ticker.in_(tickers),
                Run.status == RunStatus.completed,
                Run.verdict.isnot(None),
            )
            .distinct(Run.ticker)
            .order_by(Run.ticker, desc(Run.created_at))
        )
        for run in runs_result.scalars():
            days = (today - run.analysis_date).days
            last_verdicts[run.ticker] = (run.verdict.value, days)

    total_market_value = 0.0
    total_cost = 0.0
    has_price = False
    enriched: list[dict] = []

    for h in holdings:
        price = price_map.get(h.ticker)
        market_value = h.shares * price if price is not None else None
        pnl_pct = ((price / h.avg_cost - 1) * 100) if price is not None and h.avg_cost else None

        if market_value is not None:
            total_market_value += market_value
            has_price = True
            if h.avg_cost is not None:
                total_cost += h.avg_cost * h.shares

        verdict_info = last_verdicts.get(h.ticker)
        enriched.append({
            "ticker": h.ticker,
            "sector": sector_map.get(h.ticker, "Unknown"),
            "shares": h.shares,
            "avg_cost": round(h.avg_cost, 2) if h.avg_cost else None,
            "current_price": round(price, 2) if price else None,
            "market_value": round(market_value, 2) if market_value else None,
            "weight_pct": None,
            "unrealized_pnl_pct": round(pnl_pct, 2) if pnl_pct is not None else None,
            "last_verdict": verdict_info[0] if verdict_info else None,
            "days_since_analysis": verdict_info[1] if verdict_info else None,
        })

    for e in enriched:
        if e["market_value"] and total_market_value > 0:
            e["weight_pct"] = round(e["market_value"] / total_market_value * 100, 1)

    total_pnl = (total_market_value - total_cost) if has_price and total_cost else None
    total_value_str = f"${total_market_value:,.2f}" if has_price else "N/A (prices unavailable)"
    total_pnl_str = f"${total_pnl:+,.2f}" if total_pnl is not None else "N/A"

    profile_block = ""
    if investor_profile:
        serialized = _serialize_investor_profile(investor_profile)
        if serialized:
            profile_block = serialized + "\n"

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        portfolio_name=portfolio.name,
        total_value=total_value_str,
        total_pnl=total_pnl_str,
        holding_count=len(holdings),
        profile_block=profile_block,
        holdings_text=_format_holdings(enriched),
        sector_text=_format_sectors(enriched, total_market_value),
        insight_block=_format_insight_block(latest_insight),
    )

    full_prompt = _build_conversation_prompt(system_prompt, conversation_history, message)
    return await _call_llm(llm_provider, llm_model, llm_api_key, full_prompt)
