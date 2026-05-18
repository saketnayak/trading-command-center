"""Computes behavioral pattern alerts from existing run and insight data."""
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.portfolio_insight import PortfolioInsight, InsightStatus
from app.models.run import Run, RunStatus


# ── Detection helpers ──────────────────────────────────────────────────────────

def _detect_ignored_sell_signals(
    holdings: list,
    verdicts_by_ticker: dict[str, tuple[str, int, date]],
    value_map: dict[str, float],
    total_value: float,
) -> list[dict]:
    """Flag holdings with a SELL verdict older than 14 days still in the portfolio."""
    alerts = []
    for h in holdings:
        info = verdicts_by_ticker.get(h.ticker)
        if not info:
            continue
        verdict, days, _ = info
        if verdict != "sell" or days < 14:
            continue
        severity = "critical" if days > 30 else "warning"
        weight_pct = round(value_map.get(h.ticker, 0) / total_value * 100, 1) if total_value > 0 else None
        desc_str = (
            f"{h.ticker} has had a SELL verdict for {days} days"
            + (f" and remains {weight_pct}% of your portfolio." if weight_pct is not None else ".")
        )
        alerts.append({
            "type": "ignored_sell_signal",
            "severity": severity,
            "title": "Ignored Sell Signal",
            "description": desc_str,
            "affected_tickers": [h.ticker],
            "days": days,
            "current_weight_pct": weight_pct,
            "suggested_action": f"Run a fresh analysis on {h.ticker} or consider reducing your position.",
        })
    return alerts


def _detect_concentration_drift(
    holdings: list,
    value_map: dict[str, float],
    sector_map: dict[str, str],
    total_value: float,
) -> list[dict]:
    """Flag single positions >25% or sectors >40% of portfolio value."""
    if total_value <= 0:
        return []
    alerts = []

    for h in holdings:
        weight = value_map.get(h.ticker, 0) / total_value * 100
        if weight < 25:
            continue
        severity = "critical" if weight > 35 else "warning"
        alerts.append({
            "type": "concentration_drift",
            "severity": severity,
            "title": "Concentration Risk",
            "description": (
                f"{h.ticker} is {weight:.1f}% of your portfolio, "
                f"exceeding the 25% single-position threshold."
            ),
            "affected_tickers": [h.ticker],
            "current_weight_pct": round(weight, 1),
            "threshold_pct": 25.0,
            "suggested_action": f"Consider trimming {h.ticker} to reduce concentration risk.",
        })

    sector_totals: dict[str, float] = {}
    sector_tickers: dict[str, list[str]] = {}
    for h in holdings:
        sector = sector_map.get(h.ticker, "Unknown")
        sector_totals[sector] = sector_totals.get(sector, 0.0) + value_map.get(h.ticker, 0)
        sector_tickers.setdefault(sector, []).append(h.ticker)

    for sector, total in sector_totals.items():
        if sector == "Unknown":
            continue
        weight = total / total_value * 100
        if weight < 40:
            continue
        severity = "critical" if weight > 55 else "warning"
        alerts.append({
            "type": "concentration_drift",
            "severity": severity,
            "title": "Sector Concentration Risk",
            "description": (
                f"Your {sector} exposure is {weight:.1f}% of your portfolio, "
                f"exceeding the 40% sector threshold."
            ),
            "affected_tickers": sector_tickers.get(sector, []),
            "current_weight_pct": round(weight, 1),
            "threshold_pct": 40.0,
            "suggested_action": f"Consider diversifying away from the {sector} sector.",
        })

    return alerts


def _detect_complacency(
    tickers: list[str],
    verdicts_by_ticker: dict,
    most_recent_run_at: Optional[datetime],
) -> list[dict]:
    """Flag inactivity: no runs in 14+ days, or >50% of holdings never analyzed."""
    alerts = []
    total = len(tickers)

    days_since: Optional[int] = None
    if most_recent_run_at is not None:
        days_since = (datetime.now(timezone.utc).replace(tzinfo=None) - most_recent_run_at.replace(tzinfo=None)).days

    if days_since is None or days_since >= 14:
        severity = "critical" if (days_since is None or days_since > 30) else "warning"
        description = (
            "You haven't analyzed any holdings yet."
            if days_since is None
            else f"You haven't analyzed any holdings in {days_since} days."
        )
        alerts.append({
            "type": "complacency",
            "severity": severity,
            "title": "No Recent Analysis",
            "description": description,
            "affected_tickers": [],
            "days_since_last_run": days_since,
            "unanalyzed_count": total - len(verdicts_by_ticker),
            "total_holdings": total,
            "suggested_action": "Click 'Analyze All Stale' to run fresh analysis on your holdings.",
        })

    unanalyzed = [t for t in tickers if t not in verdicts_by_ticker]
    if len(unanalyzed) > total / 2 and total > 0:
        existing = next((a for a in alerts if a["type"] == "complacency"), None)
        if existing:
            existing["affected_tickers"] = unanalyzed
            existing["unanalyzed_count"] = len(unanalyzed)
            existing["severity"] = "critical"
        else:
            alerts.append({
                "type": "complacency",
                "severity": "critical",
                "title": "Many Unanalyzed Holdings",
                "description": f"{len(unanalyzed)} of {total} holdings have never been analyzed.",
                "affected_tickers": unanalyzed,
                "days_since_last_run": days_since,
                "unanalyzed_count": len(unanalyzed),
                "total_holdings": total,
                "suggested_action": "Click 'Analyze All Stale' to run fresh analysis on your holdings.",
            })

    return alerts


def _detect_repeated_action_items(recent_insights: list) -> list[dict]:
    """Flag ticker+action pairs appearing in 3+ consecutive insights."""
    if len(recent_insights) < 3:
        return []

    insight_pairs: list[set[tuple[str, str]]] = []
    for insight in recent_insights:
        pairs: set[tuple[str, str]] = set()
        for item in (insight.action_items or []):
            ticker = item.get("ticker")
            action = item.get("action")
            if ticker and action:
                pairs.add((ticker, action))
        insight_pairs.append(pairs)

    all_pairs: set[tuple[str, str]] = set().union(*insight_pairs)

    alerts = []
    for pair in all_pairs:
        consecutive = 0
        for pairs in insight_pairs:
            if pair in pairs:
                consecutive += 1
            else:
                break
        if consecutive < 3:
            continue
        severity = "critical" if consecutive >= 5 else "warning"
        ticker, action = pair
        first_seen = recent_insights[consecutive - 1].generated_at
        alerts.append({
            "type": "repeated_action_item",
            "severity": severity,
            "title": "Repeated Action Item",
            "description": (
                f"'{action} {ticker}' has appeared in your last {consecutive} "
                f"consecutive insights without action."
            ),
            "affected_tickers": [ticker],
            "consecutive_count": consecutive,
            "first_seen_date": first_seen.isoformat(),
            "suggested_action": (
                f"'{action} {ticker}' has appeared in your last {consecutive} insights. "
                f"Consider acting on this recommendation or re-evaluating it."
            ),
        })

    return alerts


# ── Public entry point ─────────────────────────────────────────────────────────

async def compute_behavioral_alerts(
    portfolio_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> list[dict]:
    """Orchestrate all detectors and return sorted alerts (critical first)."""
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

    if not tickers:
        return []

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

    value_map: dict[str, float] = {}
    sector_map: dict[str, str] = {}

    if latest_insight and isinstance(latest_insight.holdings_snapshot, dict):
        for ticker, data in latest_insight.holdings_snapshot.items():
            if not isinstance(data, dict):
                continue
            val = data.get("market_value")
            if val is not None:
                value_map[ticker] = float(val)
            sec = data.get("sector")
            if sec:
                sector_map[ticker] = sec

    for h in holdings:
        if h.ticker not in value_map and h.avg_cost and h.shares:
            value_map[h.ticker] = float(h.avg_cost) * float(h.shares)

    total_value = sum(value_map.values())

    verdicts_result = await db.execute(
        select(Run)
        .where(
            Run.created_by == user_id,
            Run.ticker.in_(tickers),
            Run.status == RunStatus.completed,
            Run.verdict.isnot(None),
        )
        .distinct(Run.ticker)
        .order_by(Run.ticker, desc(Run.analysis_date))
    )
    today = date.today()
    verdicts_by_ticker: dict[str, tuple[str, int, date]] = {}
    for run in verdicts_result.scalars():
        days = (today - run.analysis_date).days
        verdicts_by_ticker[run.ticker] = (run.verdict.value, days, run.analysis_date)

    recent_run_result = await db.execute(
        select(Run.created_at)
        .where(Run.created_by == user_id, Run.ticker.in_(tickers))
        .order_by(desc(Run.created_at))
        .limit(1)
    )
    most_recent_run_at: Optional[datetime] = recent_run_result.scalar_one_or_none()

    insights_result = await db.execute(
        select(PortfolioInsight)
        .where(
            PortfolioInsight.portfolio_id == portfolio_id,
            PortfolioInsight.status == InsightStatus.completed,
            PortfolioInsight.action_items.isnot(None),
        )
        .order_by(desc(PortfolioInsight.generated_at))
        .limit(5)
    )
    recent_insights = list(insights_result.scalars().all())

    alerts: list[dict] = []
    alerts.extend(_detect_ignored_sell_signals(holdings, verdicts_by_ticker, value_map, total_value))
    alerts.extend(_detect_concentration_drift(holdings, value_map, sector_map, total_value))
    alerts.extend(_detect_complacency(tickers, verdicts_by_ticker, most_recent_run_at))
    alerts.extend(_detect_repeated_action_items(recent_insights))

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: severity_order.get(a["severity"], 9))

    return alerts
