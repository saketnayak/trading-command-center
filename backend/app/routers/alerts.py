"""Alerts: rule CRUD, a dry-run "check now", the natural-language compiler, and the in-app inbox.

Rules are per user. Ticker rules may name a portfolio, whose delivery
settings the webhook channel then uses; portfolio rules (and compound rules
over holdings) must name one. Evaluation happens in the scheduler
(services/alert_engine.py). `POST /alerts/compile` turns a sentence into a
proposed rule with the user's default LLM, validated exactly like a manual
rule; it never saves, and the LLM never evaluates anything.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.alert import AlertEvent, AlertRule
from app.models.portfolio import Portfolio
from app.models.user import User
from app.models.run import Run
from app.services import alert_compiler, alert_compound, alert_engine
from app.services.alert_rules import KINDS, TICKER_RE, RuleParamError, rule_scope, validate_params

router = APIRouter()

MAX_RULES_PER_USER = 100
Channel = Literal["inbox", "email", "webhook"]


class RuleCreate(BaseModel):
    kind: str
    ticker: str | None = None
    portfolio_id: UUID | None = None
    params: dict = Field(default_factory=dict)
    channels: list[Channel] = Field(default_factory=lambda: ["inbox"])
    cooldown_hours: int = Field(default=6, ge=0, le=168)
    enabled: bool = True
    rerun_analysis: bool = False


class RuleUpdate(BaseModel):
    params: dict | None = None
    channels: list[Channel] | None = None
    cooldown_hours: int | None = Field(default=None, ge=0, le=168)
    enabled: bool | None = None
    rerun_analysis: bool | None = None


class CompileRequest(BaseModel):
    text: str = Field(min_length=3, max_length=alert_compiler.MAX_TEXT)


class MarkRead(BaseModel):
    ids: list[UUID] | None = None
    all: bool = False


def _rule_dict(r: AlertRule, portfolio_name: str | None = None) -> dict:
    return {
        "id": str(r.id),
        "kind": r.kind,
        "kind_label": KINDS[r.kind].label if r.kind in KINDS else r.kind,
        "ticker": r.ticker,
        "portfolio_id": str(r.portfolio_id) if r.portfolio_id else None,
        "portfolio_name": portfolio_name,
        "params": r.params,
        "channels": r.channels,
        "cooldown_hours": r.cooldown_hours,
        "enabled": r.enabled,
        "rerun_analysis": bool(r.rerun_analysis),
        "state": r.state,
        "last_checked_at": r.last_checked_at.isoformat() if r.last_checked_at else None,
        "last_triggered_at": r.last_triggered_at.isoformat() if r.last_triggered_at else None,
        "last_error": r.last_error,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _event_dict(e: AlertEvent, runs: dict[str, Run] | None = None) -> dict:
    analyses = []
    for a in (e.data or {}).get("analyses") or []:
        run = (runs or {}).get(a.get("run_id"))
        analyses.append({
            "ticker": a.get("ticker"), "run_id": a.get("run_id"), "source": a.get("source"),
            "status": run.status.value if run else "deleted",
            "verdict": run.verdict.value if run and run.verdict else None,
        })
    return {
        "id": str(e.id),
        "rule_id": str(e.rule_id) if e.rule_id else None,
        "kind": e.kind,
        "ticker": e.ticker,
        "portfolio_id": str(e.portfolio_id) if e.portfolio_id else None,
        "title": e.title,
        "message": e.message,
        "data": e.data,
        "delivery": e.delivery,
        "analyses": analyses,
        "triggered_at": e.triggered_at.isoformat() if e.triggered_at else None,
        "read_at": e.read_at.isoformat() if e.read_at else None,
    }


async def _own_portfolio(db: AsyncSession, portfolio_id: UUID, user: User) -> Portfolio:
    p = (await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


async def _own_rule(db: AsyncSession, rule_id: UUID, user: User) -> AlertRule:
    r = (await db.execute(select(AlertRule).where(AlertRule.id == rule_id, AlertRule.user_id == user.id))).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    return r


def _channels(channels: list[str], portfolio_id) -> list[str]:
    out = ["inbox"] + sorted({c for c in channels if c != "inbox"})
    if "webhook" in out and portfolio_id is None:
        raise HTTPException(status_code=422, detail="Webhook delivery uses a portfolio's delivery settings; choose a portfolio.")
    return out


@router.get("/alerts/rules")
async def list_rules(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        await db.execute(
            select(AlertRule, Portfolio.name)
            .outerjoin(Portfolio, Portfolio.id == AlertRule.portfolio_id)
            .where(AlertRule.user_id == user.id)
            .order_by(AlertRule.created_at.desc())
        )
    ).all()
    return [_rule_dict(r, name) for r, name in rows]


async def _normalize(db: AsyncSession, user: User, body: RuleCreate, *, allow_missing_portfolio: bool = False) -> dict:
    """Validate a rule exactly as it will be saved (manual and compiled rules alike).
    Raises HTTPException (422, or 404 for someone else's portfolio)."""
    try:
        params = validate_params(body.kind, body.params)
    except RuleParamError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    scope = rule_scope(body.kind, params)
    ticker = body.ticker.strip().upper() if body.ticker else None
    if scope == "ticker":
        if not ticker or not TICKER_RE.match(ticker):
            raise HTTPException(status_code=422, detail="This alert needs a valid ticker")
    else:
        ticker = None
    needs_portfolio = scope == "portfolio" or (body.kind == "compound" and alert_compound.needs_portfolio(params))
    if needs_portfolio and body.portfolio_id is None and not allow_missing_portfolio:
        raise HTTPException(status_code=422, detail=(
            "This alert needs a portfolio" if scope == "portfolio" else "A portfolio-weight condition needs a portfolio"))
    if body.rerun_analysis and body.kind == "portfolio_drawdown":
        raise HTTPException(status_code=422, detail="A drawdown alert is about the whole portfolio, so there is no analysis to re-run")
    portfolio = await _own_portfolio(db, body.portfolio_id, user) if body.portfolio_id else None
    channels = _channels(body.channels, body.portfolio_id)
    return {
        "kind": body.kind, "ticker": ticker, "portfolio_id": body.portfolio_id, "params": params,
        "channels": channels, "cooldown_hours": body.cooldown_hours, "enabled": body.enabled,
        "rerun_analysis": body.rerun_analysis, "portfolio_name": portfolio.name if portfolio else None,
        "needs_portfolio": needs_portfolio,
    }


@router.post("/alerts/rules", status_code=status.HTTP_201_CREATED)
async def create_rule(body: RuleCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    fields = await _normalize(db, user, body)
    count = (await db.execute(select(func.count()).select_from(AlertRule).where(AlertRule.user_id == user.id))).scalar_one()
    if count >= MAX_RULES_PER_USER:
        raise HTTPException(status_code=409, detail=f"At most {MAX_RULES_PER_USER} alert rules per user")
    portfolio_name = fields.pop("portfolio_name")
    fields.pop("needs_portfolio")
    rule = AlertRule(user_id=user.id, state=None, **fields)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _rule_dict(rule, portfolio_name)


@router.post("/alerts/compile")
async def compile_rule(body: CompileRequest, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Turn a sentence into a proposed rule with the user's default LLM. Never saves.

    Returns 200 with `ok: false` and `problems` / `unsupported` when the sentence
    can't be turned into a valid rule, so the UI can say what it didn't understand."""
    from app.services import llm_selection
    from app.services.llm_provider_registry import is_local_provider
    from app.services.portfolio_insight_runner import _get_api_key

    picked = await llm_selection.pick_llm_for_user(db, user)
    if picked is None:
        raise HTTPException(status_code=422, detail="No LLM provider key is configured. Add one in Settings to describe alerts in words.")
    provider, model = picked
    api_key = await _get_api_key(provider, db)
    if not api_key and not is_local_provider(provider):
        raise HTTPException(status_code=422, detail="The LLM provider key could not be read. Check it in Settings.")

    rows = (await db.execute(select(Portfolio.id, Portfolio.name).where(Portfolio.user_id == user.id)
                             .order_by(Portfolio.created_at))).all()
    portfolios = [(str(pid), name) for pid, name in rows]
    prompt = alert_compiler.build_prompt(body.text.strip(), [n for _, n in portfolios], datetime.now(timezone.utc).date())
    try:
        raw = await alert_compiler.ask_llm(provider, model, api_key, prompt)
        reply = alert_compiler.parse_reply(raw)
    except alert_compiler.CompileError as exc:
        return {"ok": False, "rule": None, "unsupported": [], "problems": [str(exc)], "needs_portfolio": False,
                "llm": f"{provider}/{model}"}
    except Exception as exc:  # noqa: BLE001 - provider errors surface as a 502
        raise HTTPException(status_code=502, detail=f"The LLM call failed: {type(exc).__name__}: {exc}"[:300]) from exc

    out = {"ok": False, "rule": None, "unsupported": reply["unsupported"], "problems": [], "needs_portfolio": False,
           "llm": f"{provider}/{model}"}
    proposed = reply["rule"]
    if proposed is None:
        if not out["unsupported"]:
            out["problems"].append("That couldn't be turned into an alert rule.")
        return out

    pid, problem = alert_compiler.match_portfolio(proposed.get("portfolio") or proposed.get("portfolio_id"), portfolios)
    if problem:
        out["problems"].append(problem)
        return out
    channels = [c for c in (proposed.get("channels") or ["inbox"]) if c in ("inbox", "email", "webhook")] or ["inbox"]
    wants_webhook = "webhook" in channels
    try:
        candidate = RuleCreate(
            kind=str(proposed.get("kind") or ""), ticker=proposed.get("ticker") or None, portfolio_id=pid,
            params=alert_compiler.tidy_params(proposed.get("params")), channels=[c for c in channels if c != "webhook"],
            rerun_analysis=bool(proposed.get("rerun_analysis")),
        )
        fields = await _normalize(db, user, candidate, allow_missing_portfolio=True)
        if fields["needs_portfolio"] and fields["portfolio_id"] is None:
            if len(portfolios) == 1:  # the only portfolio is the obvious one
                candidate = candidate.model_copy(update={"portfolio_id": UUID(portfolios[0][0])})
                fields = await _normalize(db, user, candidate)
            elif not portfolios:
                out["problems"].append("This alert watches a portfolio, and you don't have one yet.")
                return out
            else:
                out["needs_portfolio"] = True  # the approval card asks which one
    except HTTPException as exc:
        out["problems"].append(str(exc.detail))
        return out
    except ValueError as exc:  # pydantic: a field of the wrong type
        out["problems"].append(str(exc).splitlines()[0])
        return out

    if wants_webhook:
        if fields["portfolio_id"] is not None or out["needs_portfolio"]:
            fields["channels"] = sorted({*fields["channels"], "webhook"}, key=["inbox", "email", "webhook"].index)
        else:
            out["unsupported"].append("webhook delivery: pick a portfolio for its webhook before saving")
    rule = {k: v for k, v in fields.items() if k != "needs_portfolio"}
    rule["portfolio_id"] = str(rule["portfolio_id"]) if rule["portfolio_id"] else None
    out.update(ok=True, rule=rule)
    return out


@router.patch("/alerts/rules/{rule_id}")
async def update_rule(rule_id: UUID, body: RuleUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rule = await _own_rule(db, rule_id, user)
    if body.params is not None:
        try:
            rule.params = validate_params(rule.kind, body.params)
        except RuleParamError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        rule.state = None  # a new threshold starts a fresh edge/baseline
    if body.channels is not None:
        rule.channels = _channels(body.channels, rule.portfolio_id)
    if body.cooldown_hours is not None:
        rule.cooldown_hours = body.cooldown_hours
    if body.enabled is not None:
        rule.enabled = body.enabled
    if body.rerun_analysis is not None:
        if body.rerun_analysis and rule.kind == "portfolio_drawdown":
            raise HTTPException(status_code=422, detail="A drawdown alert is about the whole portfolio, so there is no analysis to re-run")
        rule.rerun_analysis = body.rerun_analysis
    await db.commit()
    await db.refresh(rule)
    portfolio = await db.get(Portfolio, rule.portfolio_id) if rule.portfolio_id else None
    return _rule_dict(rule, portfolio.name if portfolio else None)


@router.delete("/alerts/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rule = await _own_rule(db, rule_id, user)
    await db.delete(rule)
    await db.commit()


@router.post("/alerts/rules/{rule_id}/check")
async def check_rule(rule_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Evaluate against live data now. Read-only: no state change, nothing fires."""
    rule = await _own_rule(db, rule_id, user)
    ev = await alert_engine.check_rule(db, rule)
    family = KINDS[rule.kind].family
    if rule.kind == "compound":
        note = ("Fires for each holding that starts matching, then re-arms once it stops."
                if rule.params.get("scope") == "holdings" else
                "Fires when all of this becomes true, then re-arms once it is false again."
                if rule.params.get("op") == "and" else
                "Fires when any of this becomes true, then re-arms once none of it is.")
        return {"condition": ev.condition, "observed": ev.observed, "would_fire": ev.fire, "note": note}
    return {
        "condition": ev.condition,
        "observed": ev.observed,
        "would_fire": ev.fire,
        "note": (
            "Fires when this becomes true, then re-arms once it is false again."
            if family == "level" else
            "Fires when this value changes from the one recorded at the last check."
        ),
    }


@router.get("/alerts/events")
async def list_events(
    limit: int = Query(50, ge=1, le=200),
    unread_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(AlertEvent).where(AlertEvent.user_id == user.id)
    if unread_only:
        q = q.where(AlertEvent.read_at.is_(None))
    rows = (await db.execute(q.order_by(AlertEvent.triggered_at.desc()).limit(limit))).scalars().all()
    run_ids = {UUID(a["run_id"]) for e in rows for a in (e.data or {}).get("analyses") or [] if a.get("run_id")}
    runs: dict[str, Run] = {}
    if run_ids:
        found = (await db.execute(select(Run).where(Run.id.in_(run_ids), Run.created_by == user.id))).scalars().all()
        runs = {str(r.id): r for r in found}
    return [_event_dict(e, runs) for e in rows]


@router.get("/alerts/unread-count")
async def unread_count(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    n = (await db.execute(select(func.count()).select_from(AlertEvent).where(
        AlertEvent.user_id == user.id, AlertEvent.read_at.is_(None)))).scalar_one()
    return {"unread": n}


@router.post("/alerts/events/read")
async def mark_read(body: MarkRead, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if not body.all and not body.ids:
        raise HTTPException(status_code=422, detail="Pass ids or all=true")
    q = update(AlertEvent).where(AlertEvent.user_id == user.id, AlertEvent.read_at.is_(None))
    if not body.all:
        q = q.where(AlertEvent.id.in_(body.ids))
    result = await db.execute(q.values(read_at=datetime.now(timezone.utc)))
    await db.commit()
    return {"marked": result.rowcount or 0}
