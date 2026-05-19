"""Email and webhook delivery for portfolio AI insights."""
import logging
import uuid
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_http_client = httpx.AsyncClient(timeout=10.0)


# ── Email ──────────────────────────────────────────────────────────────────────

def _build_email_html(
    portfolio_name: str,
    date_str: str,
    health: int,
    stance: str,
    summary: str,
    action_items: list,
    risk_alerts: list,
    frontend_url: str,
) -> str:
    dots = "●" * health + "○" * (10 - health)
    app_url = f"{frontend_url.rstrip('/')}/portfolio"

    action_rows = ""
    for item in action_items[:5]:
        priority = str(item.get("priority", "")).upper()
        ticker = item.get("ticker", "")
        action = item.get("action", "")
        rationale = str(item.get("rationale", ""))[:100]
        icon = "⚡" if priority == "HIGH" else "⚠️" if priority in ("MED", "MEDIUM") else "ℹ️"
        action_rows += (
            f"<tr>"
            f"<td style='padding:5px 10px;color:#94a3b8;white-space:nowrap;font-size:12px'>{icon} {priority}</td>"
            f"<td style='padding:5px 10px;color:#e2e8f0;font-size:13px'><strong>{ticker}</strong> · {action}</td>"
            f"<td style='padding:5px 10px;color:#94a3b8;font-size:12px'>{rationale}</td>"
            f"</tr>"
        )

    risk_rows = ""
    for alert in risk_alerts[:3]:
        severity = str(alert.get("severity", "")).upper()
        desc = str(alert.get("description", ""))[:120]
        icon = "🔴" if severity == "CRITICAL" else "🟡"
        risk_rows += (
            f"<tr>"
            f"<td style='padding:5px 10px;white-space:nowrap;font-size:12px'>{icon} {severity}</td>"
            f"<td style='padding:5px 10px;color:#e2e8f0;font-size:13px'>{desc}</td>"
            f"</tr>"
        )

    actions_block = (
        f"<tr><td style='background:#1e293b;padding:18px 24px;border-bottom:1px solid #334155'>"
        f"<p style='margin:0 0 10px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:1px'>Top Action Items</p>"
        f"<table width='100%' cellpadding='0' cellspacing='0'>{action_rows}</table>"
        f"</td></tr>"
        if action_rows else ""
    )
    risks_block = (
        f"<tr><td style='background:#1e293b;padding:18px 24px;border-bottom:1px solid #334155'>"
        f"<p style='margin:0 0 10px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:1px'>Risk Alerts</p>"
        f"<table width='100%' cellpadding='0' cellspacing='0'>{risk_rows}</table>"
        f"</td></tr>"
        if risk_rows else ""
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AgentFloor Morning Brief</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#1e293b;border-radius:12px 12px 0 0;padding:22px 24px;border-bottom:1px solid #334155">
    <p style="margin:0 0 4px;color:#64748b;font-size:11px;letter-spacing:1px;text-transform:uppercase">Morning Brief · {date_str}</p>
    <h1 style="margin:0;color:#f1f5f9;font-size:20px;font-weight:700">{portfolio_name}</h1>
  </td></tr>
  <tr><td style="background:#1e293b;padding:18px 24px;border-bottom:1px solid #334155">
    <p style="margin:0 0 4px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:1px">Health Score</p>
    <p style="margin:0;color:#22c55e;font-size:18px;letter-spacing:2px">{dots}</p>
    <p style="margin:4px 0 0;color:#94a3b8;font-size:13px">{health}/10 · {stance}</p>
  </td></tr>
  <tr><td style="background:#1e293b;padding:18px 24px;border-bottom:1px solid #334155">
    <p style="margin:0 0 10px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:1px">Summary</p>
    <p style="margin:0;color:#cbd5e1;font-size:14px;line-height:1.6">{summary[:500]}</p>
  </td></tr>
  {actions_block}
  {risks_block}
  <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:20px 24px;text-align:center">
    <a href="{app_url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px">View full insights →</a>
    <p style="margin:14px 0 0;color:#475569;font-size:11px">AgentFloor · <a href="{app_url}" style="color:#475569">Manage delivery settings</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


async def send_brief_email(
    portfolio_name: str,
    date_str: str,
    health: int,
    stance: str,
    summary: str,
    action_items: list,
    risk_alerts: list,
    to_address: str,
) -> None:
    import aiosmtplib
    from email.message import EmailMessage

    frontend_url = getattr(settings, "frontend_url", "http://localhost:3000")
    html = _build_email_html(
        portfolio_name=portfolio_name,
        date_str=date_str,
        health=health,
        stance=stance,
        summary=summary,
        action_items=action_items,
        risk_alerts=risk_alerts,
        frontend_url=frontend_url,
    )

    if not settings.smtp_host:
        logger.info("[email stub] Morning brief for %s → %s", portfolio_name, to_address)
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to_address
    msg["Subject"] = f"AgentFloor Morning Brief — {portfolio_name} · {date_str}"
    msg.set_content(f"Morning Brief for {portfolio_name} — {date_str}\n\nHealth: {health}/10 · {stance}\n\n{summary}")
    msg.add_alternative(html, subtype="html")

    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user or None,
        password=settings.smtp_password or None,
        start_tls=True,
    )


# ── Webhook ────────────────────────────────────────────────────────────────────

def _build_json_payload(
    portfolio_id: str,
    portfolio_name: str,
    generated_at: str,
    health: int,
    stance: str,
    summary: str,
    action_items: list,
    risk_alerts: list,
    sector_analysis: Optional[dict],
    strengths: list,
    weaknesses: list,
) -> dict:
    return {
        "portfolio_id": portfolio_id,
        "portfolio_name": portfolio_name,
        "generated_at": generated_at,
        "health_score": health,
        "overall_stance": stance,
        "summary": summary,
        "action_items": action_items,
        "risk_alerts": risk_alerts,
        "sector_analysis": sector_analysis or {},
        "strengths": strengths,
        "weaknesses": weaknesses,
    }


def _build_telegram_text(
    portfolio_name: str,
    date_str: str,
    health: int,
    stance: str,
    summary: str,
    action_items: list,
    risk_alerts: list,
) -> str:
    dots = "●" * health + "○" * (10 - health)
    lines = [
        f"<b>AgentFloor Morning Brief — {portfolio_name}</b>",
        f"<i>{date_str}</i>",
        "",
        f"<b>Health:</b> {dots} {health}/10 · {stance.title()}",
        "",
        f"<b>Summary</b>",
        summary[:400],
    ]
    if action_items:
        lines += ["", "<b>Top Actions</b>"]
        for item in action_items[:3]:
            ticker = item.get("ticker", "")
            action = item.get("action", "")
            priority = str(item.get("priority", "")).upper()
            icon = "⚡" if priority == "HIGH" else "⚠" if priority in ("MED", "MEDIUM") else "ℹ"
            lines.append(f"{icon} <b>{ticker}</b> · {action}")
    if risk_alerts:
        lines += ["", "<b>Risk Alerts</b>"]
        for alert in risk_alerts[:2]:
            severity = str(alert.get("severity", "")).upper()
            desc = str(alert.get("description", ""))[:100]
            icon = "🔴" if severity == "CRITICAL" else "🟡"
            lines.append(f"{icon} {desc}")
    return "\n".join(lines)


def _build_slack_payload(
    portfolio_name: str,
    date_str: str,
    health: int,
    stance: str,
    action_items: list,
    frontend_url: str,
) -> dict:
    app_url = f"{frontend_url.rstrip('/')}/portfolio"
    top_action = ""
    if action_items:
        item = action_items[0]
        top_action = f"{item.get('action', '')} {item.get('ticker', '')} — {str(item.get('rationale', ''))[:80]}"

    blocks: list = [
        {"type": "header", "text": {"type": "plain_text", "text": f"{portfolio_name} · {date_str}"}},
        {"type": "section", "text": {"type": "mrkdwn", "text": f"*Health Score:* {health}/10 | *Stance:* {stance.title()}"}},
    ]
    if top_action:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Top Action:* {top_action}"}})
    blocks += [
        {"type": "section", "text": {"type": "mrkdwn", "text": f"📊 <{app_url}|View full insights>"}},
        {"type": "divider"},
    ]
    return {"text": f"AgentFloor Morning Brief — {portfolio_name}", "blocks": blocks}


async def send_webhook_brief(
    webhook_url: str,
    webhook_format: str,
    portfolio_id: str,
    portfolio_name: str,
    generated_at: str,
    health: int,
    stance: str,
    summary: str,
    action_items: list,
    risk_alerts: list,
    sector_analysis: Optional[dict],
    strengths: list,
    weaknesses: list,
    date_str: str,
    telegram_chat_id: Optional[str] = None,
) -> None:
    frontend_url = getattr(settings, "frontend_url", "http://localhost:3000")
    if webhook_format == "telegram":
        text = _build_telegram_text(
            portfolio_name=portfolio_name,
            date_str=date_str,
            health=health,
            stance=stance,
            summary=summary,
            action_items=action_items,
            risk_alerts=risk_alerts,
        )
        payload: dict = {"chat_id": telegram_chat_id, "text": text, "parse_mode": "HTML"}
    elif webhook_format == "slack":
        payload = _build_slack_payload(
            portfolio_name=portfolio_name,
            date_str=date_str,
            health=health,
            stance=stance,
            action_items=action_items,
            frontend_url=frontend_url,
        )
    else:
        payload = _build_json_payload(
            portfolio_id=portfolio_id,
            portfolio_name=portfolio_name,
            generated_at=generated_at,
            health=health,
            stance=stance,
            summary=summary,
            action_items=action_items,
            risk_alerts=risk_alerts,
            sector_analysis=sector_analysis,
            strengths=strengths,
            weaknesses=weaknesses,
        )

    resp = await _http_client.post(
        webhook_url,
        json=payload,
        headers={"Content-Type": "application/json"},
    )
    if not resp.is_success:
        try:
            description = resp.json().get("description") or resp.text
        except Exception:
            description = resp.text or str(resp.status_code)
        raise ValueError(f"HTTP {resp.status_code}: {description}")


# ── Orchestrator ───────────────────────────────────────────────────────────────

async def deliver_insight_if_configured(insight_id: str) -> None:
    """Open a fresh DB session, load delivery settings, dispatch email/webhook."""
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models.portfolio import Portfolio
    from app.models.portfolio_delivery_settings import PortfolioDeliverySettings
    from app.models.portfolio_insight import PortfolioInsight
    from app.models.user import User

    try:
        async with AsyncSessionLocal() as db:
            insight = await db.get(PortfolioInsight, uuid.UUID(insight_id))
            if not insight:
                return
            portfolio = await db.get(Portfolio, insight.portfolio_id)
            if not portfolio:
                return
            user_result = await db.execute(select(User).where(User.id == portfolio.user_id))
            user = user_result.scalar_one_or_none()
            if not user:
                return
            ds_result = await db.execute(
                select(PortfolioDeliverySettings).where(
                    PortfolioDeliverySettings.portfolio_id == portfolio.id
                )
            )
            ds = ds_result.scalar_one_or_none()
            if not ds:
                return

            date_str = (f"{insight.generated_at.strftime('%b')} {insight.generated_at.day}, {insight.generated_at.year}" if insight.generated_at else "Today")
            health = insight.health_score or 0
            stance = insight.overall_stance.value if insight.overall_stance else "neutral"
            summary = insight.summary or ""
            action_items = insight.action_items or []
            risk_alerts = insight.risk_alerts or []
            generated_at = insight.generated_at.isoformat() if insight.generated_at else ""

            if ds.email_enabled:
                email_to = ds.email_address or user.email
                await send_brief_email(
                    portfolio_name=portfolio.name,
                    date_str=date_str,
                    health=health,
                    stance=stance,
                    summary=summary,
                    action_items=action_items,
                    risk_alerts=risk_alerts,
                    to_address=email_to,
                )

            if ds.webhook_enabled and ds.webhook_url:
                await send_webhook_brief(
                    webhook_url=ds.webhook_url,
                    webhook_format=ds.webhook_format,
                    portfolio_id=str(portfolio.id),
                    portfolio_name=portfolio.name,
                    generated_at=generated_at,
                    health=health,
                    stance=stance,
                    summary=summary,
                    action_items=action_items,
                    risk_alerts=risk_alerts,
                    sector_analysis=insight.sector_analysis,
                    strengths=insight.strengths or [],
                    weaknesses=insight.weaknesses or [],
                    date_str=date_str,
                    telegram_chat_id=ds.telegram_chat_id,
                )

    except Exception:
        logger.exception("Delivery failed for insight %s", insight_id)
