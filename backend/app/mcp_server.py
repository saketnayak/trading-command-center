"""AgentFloor as an MCP server, so Claude, ChatGPT, Cursor and other MCP clients
can work with a user's own portfolio data.

Transport: stateless Streamable HTTP with JSON responses at `/mcp` (behind
nginx: `https://<host>/api/mcp`). Auth: a personal access token from
Settings → MCP access, sent as `Authorization: Bearer af_...`.

Scopes:
  read      portfolios, holdings, performance, risk, rebalance plans,
            dividend income, tax (realised gains, wash sales, harvest candidates), net worth, regimes,
            runs, reports, insights, alerts. Read-only.
  research  additionally starts an AI analysis run or a portfolio insight
            (spends the user's LLM credits).

There is no tool that places orders, and JEV Lab is not exposed.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import desc, select, update
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.mcp_token import McpToken

logger = logging.getLogger(__name__)

TOKEN_PREFIX = "af_"
SCOPES = ("read", "research")
LAST_USED_WRITE_INTERVAL = timedelta(minutes=5)


def new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(30)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


try:  # mcp arrives via chainlit in uv.lock; the app must boot without it
    from mcp.server.auth.middleware.auth_context import get_access_token
    from mcp.server.auth.provider import AccessToken
    from mcp.server.auth.settings import AuthSettings
    from mcp.server.fastmcp import FastMCP
    from mcp.server.fastmcp.exceptions import ToolError
    from mcp.server.transport_security import TransportSecuritySettings

    MCP_AVAILABLE = True
except ImportError:  # pragma: no cover
    MCP_AVAILABLE = False


class PatVerifier:
    """Resolve a bearer personal access token to its user and scopes."""

    async def verify_token(self, token: str):
        if not token.startswith(TOKEN_PREFIX):
            return None
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            row = (await db.execute(select(McpToken).where(McpToken.token_hash == hash_token(token)))).scalar_one_or_none()
            if row is None or row.revoked_at is not None or (row.expires_at and row.expires_at <= now):
                return None
            if row.last_used_at is None or now - row.last_used_at > LAST_USED_WRITE_INTERVAL:
                await db.execute(update(McpToken).where(McpToken.id == row.id).values(last_used_at=now))
                await db.commit()
            return AccessToken(
                token=token,
                client_id=str(row.user_id),
                scopes=list(row.scopes or ["read"]),
                expires_at=int(row.expires_at.timestamp()) if row.expires_at else None,
            )


# ── helpers for tools ─────────────────────────────────────────────────────────

def _caller() -> tuple[uuid.UUID, list[str]]:
    tok = get_access_token()
    if tok is None:  # the auth middleware should make this impossible
        raise ToolError("Not authenticated")
    return uuid.UUID(tok.client_id), list(tok.scopes)


def _require_research() -> uuid.UUID:
    user_id, scopes = _caller()
    if "research" not in scopes:
        raise ToolError("This token is read-only. Create a token with the 'research' scope in Settings → MCP access.")
    return user_id


async def _user(db, user_id):
    from app.models.user import User

    user = await db.get(User, user_id)
    if user is None:
        raise ToolError("User not found")
    return user


def _display_ccy(currency: str | None, user) -> str:
    """The currency a money tool answers in: the `currency` argument, else the user's preference."""
    from app.dependencies import normalize_currency

    try:
        return normalize_currency(currency, (user.preferred_currency if user else None) or "USD")
    except ValueError as e:
        raise ToolError(str(e))


async def _own_portfolio(db, user_id, portfolio_id: str):
    from app.models.portfolio import Portfolio

    try:
        pid = uuid.UUID(portfolio_id)
    except ValueError as exc:
        raise ToolError(f"'{portfolio_id}' is not a portfolio id; call list_portfolios first") from exc
    p = (await db.execute(select(Portfolio).where(Portfolio.id == pid, Portfolio.user_id == user_id))).scalar_one_or_none()
    if p is None:
        raise ToolError("Portfolio not found")
    return p


def _month_ends(series: list[dict]) -> list[dict[str, Any]]:
    by_month: dict[str, dict] = {}
    for p in series:
        by_month[p["date"][:7]] = p
    return list(by_month.values())


def _ticker(t: str) -> str:
    from app.services.alert_rules import TICKER_RE

    sym = (t or "").strip().upper()
    if not TICKER_RE.match(sym):
        raise ToolError(f"'{t}' is not a valid ticker")
    return sym


def build_server():
    """A fresh FastMCP instance with every AgentFloor tool registered."""
    if not MCP_AVAILABLE:  # pragma: no cover
        raise RuntimeError("the 'mcp' package is not installed")

    base = getattr(settings, "frontend_url", "http://localhost:3000").rstrip("/")
    server = FastMCP(
        "AgentFloor",
        instructions=(
            "AgentFloor is a research-only investing workspace. Use list_portfolios first to get portfolio ids. "
            "Figures come from stored daily prices; quote them rather than estimating. No tool can place orders."
        ),
        stateless_http=True,
        json_response=True,
        streamable_http_path="/mcp",
        token_verifier=PatVerifier(),
        auth=AuthSettings(issuer_url=base, resource_server_url=f"{base}/api/mcp", required_scopes=["read"]),
        # Every request must carry a bearer token, which a DNS-rebinding page cannot make the
        # victim's browser attach, so host checking adds nothing and would break proxied hosts.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    @server.tool()
    async def list_portfolios() -> list[dict[str, Any]]:
        """List the caller's portfolios with their ids, number of positions and last upload time."""
        from app.models.portfolio import Portfolio, PortfolioSnapshot

        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            ports = (await db.execute(select(Portfolio).where(Portfolio.user_id == user_id).order_by(Portfolio.created_at))).scalars().all()
            out = []
            for p in ports:
                snap = (await db.execute(
                    select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == p.id)
                    .order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1))).scalar_one_or_none()
                out.append({"id": str(p.id), "name": p.name, "positions": snap.row_count if snap else 0,
                            "last_upload": snap.uploaded_at.isoformat() if snap else None})
            return out

    @server.tool()
    async def get_holdings(portfolio_id: str, currency: str | None = None) -> dict[str, Any]:
        """Current holdings of a portfolio: shares, average cost, latest close, value and weight
        (in the user's display currency), plus each ticker's latest AI verdict."""
        from app.models.portfolio import PortfolioSnapshot
        from app.models.run import Run, RunStatus
        from app.services.performance_calc import PriceLookup
        from app.services.portfolio_pricing import fx_factors
        from app.services.price_history_service import get_closes

        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            await _own_portfolio(db, user_id, portfolio_id)
            user = await _user(db, user_id)
            ccy = _display_ccy(currency, user)
            snap = (await db.execute(
                select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == uuid.UUID(portfolio_id))
                .options(selectinload(PortfolioSnapshot.holdings)).order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1)
            )).scalar_one_or_none()
            if not snap or not snap.holdings:
                return {"currency": ccy, "holdings": [], "total_value": 0, "left_out": []}
            tickers = sorted({h.ticker.upper() for h in snap.holdings})
            today = datetime.now(timezone.utc).date()
            closes, _ = await get_closes(db, tickers, today - timedelta(days=14), today)
            fx, _ = await fx_factors(db, tickers, ccy)
            rows, total = [], 0.0
            left_out = sorted({h.ticker.upper() for h in snap.holdings if h.ticker.upper() not in fx})  # no rate: never 1:1
            for h in snap.holdings:
                t = h.ticker.upper()
                if t in left_out:
                    continue
                px = PriceLookup(closes.get(t, {})).at(today) if closes.get(t) else None
                value = h.shares * px * fx[t] if px is not None else None
                total += value or 0.0
                run = (await db.execute(
                    select(Run).where(Run.created_by == user_id, Run.ticker == t, Run.status == RunStatus.completed,
                                      Run.verdict.isnot(None)).order_by(desc(Run.created_at)).limit(1))).scalar_one_or_none()
                rows.append({"ticker": t, "shares": h.shares, "avg_cost": h.avg_cost, "cost_currency": h.currency,
                             "last_close": px, "value": round(value, 2) if value is not None else None,
                             "last_verdict": run.verdict.value if run else None,
                             "last_analysis_date": run.analysis_date.isoformat() if run else None})
            for r in rows:
                r["weight"] = round(r["value"] / total, 4) if r["value"] is not None and total > 0 else None
            rows.sort(key=lambda r: -(r["value"] or 0))
            return {"currency": ccy, "as_of_upload": snap.uploaded_at.isoformat(), "total_value": round(total, 2), "holdings": rows,
                    "left_out": left_out}

    @server.tool()
    async def get_performance(portfolio_id: str, range: str = "1y", benchmark: str = "SPY", mode: str = "auto",
                              currency: str | None = None) -> dict[str, Any]:
        """Time-weighted return vs a benchmark (range: 1m, 3m, 6m, ytd, 1y, 3y, 5y; mode: auto, actual, current).
        Returns stats, trailing returns, per-holding contribution and a month-end series."""
        from app.services.portfolio_performance_service import build_performance_report

        if range not in ("1m", "3m", "6m", "ytd", "1y", "3y", "5y") or mode not in ("auto", "actual", "current"):
            raise ToolError("range must be one of 1m, 3m, 6m, ytd, 1y, 3y, 5y; mode one of auto, actual, current")
        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            await _own_portfolio(db, user_id, portfolio_id)
            user = await _user(db, user_id)
            rep = await build_performance_report(db, uuid.UUID(portfolio_id), display_currency=_display_ccy(currency, user),
                                                 mode=mode, range_key=range, benchmark=_ticker(benchmark))
        rep["series"] = _month_ends(rep.get("series") or [])
        return rep

    @server.tool()
    async def get_risk(portfolio_id: str, lookback: str = "1y", benchmark: str = "SPY", currency: str | None = None) -> dict[str, Any]:
        """Risk of today's holdings (lookback: 3m, 6m, 1y, 3y): volatility, beta, 1-day VaR/CVaR, drawdown,
        concentration, each holding's share of risk, correlated clusters, stress replays and a 1-year Monte Carlo."""
        from app.services.portfolio_risk_service import build_risk_report

        if lookback not in ("3m", "6m", "1y", "3y"):
            raise ToolError("lookback must be one of 3m, 6m, 1y, 3y")
        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            await _own_portfolio(db, user_id, portfolio_id)
            user = await _user(db, user_id)
            rep = await build_risk_report(db, uuid.UUID(portfolio_id), display_currency=_display_ccy(currency, user),
                                          lookback=lookback, benchmark=_ticker(benchmark))
        risk = rep.get("risk")
        if risk:
            risk.pop("correlation", None)  # the full matrix is long; top_pairs and clusters carry the signal
            if risk.get("monte_carlo"):
                risk["monte_carlo"].pop("fan", None)
        return rep

    @server.tool()
    async def get_rebalance_plan(portfolio_id: str, mode: str = "bands", amount: float = 0.0, whole_shares: bool = False,
                                 currency: str | None = None) -> dict[str, Any]:
        """Drift against the portfolio's target weights and a trade plan (mode: bands, full, contribute, withdraw;
        amount for contribute/withdraw). A plan only: AgentFloor never places orders."""
        from app.routers.portfolio_rebalance import rebalance

        if mode not in ("bands", "full", "contribute", "withdraw"):
            raise ToolError("mode must be one of bands, full, contribute, withdraw")
        if mode in ("contribute", "withdraw") and amount <= 0:
            raise ToolError("amount must be positive for contribute and withdraw")
        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            await _own_portfolio(db, user_id, portfolio_id)
            user = await _user(db, user_id)
            return await rebalance(uuid.UUID(portfolio_id), mode=mode, amount=amount, whole_shares=whole_shares, db=db, user=user,
                                   display_currency=_display_ccy(currency, user))

    @server.tool()
    async def get_income(portfolio_id: str, currency: str | None = None) -> dict[str, Any]:
        """Dividend income: forward annual and monthly income, yield and yield on cost, each holding's
        frequency and next ex-dividend date, the next 12 months' expected payments, income received, and
        progress toward the user's monthly target. Estimates from each holding's dividend history."""
        from app.routers.portfolio_income import portfolio_income

        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            await _own_portfolio(db, user_id, portfolio_id)
            user = await _user(db, user_id)
            return await portfolio_income(uuid.UUID(portfolio_id), db=db, user=user, ccy=_display_ccy(currency, user))

    @server.tool()
    async def get_filings(portfolio_id: str, days: int = 30) -> dict[str, Any]:
        """Recent SEC filings for the portfolio's holdings (10-K/10-Q risk-factor changes vs the previous
        filing, 8-K reports with their items) and Form 4 insider buys and sells, from EDGAR. Digests are
        AI summaries whose every point quotes the filing; `url` links the filing itself. Stored data only:
        the app refreshes it nightly and when the Filings tab is opened. days: 7-120."""
        from app.services import edgar_service, filing_digest_service

        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            await _own_portfolio(db, user_id, portfolio_id)
            tickers = await edgar_service.held_tickers(db, uuid.UUID(portfolio_id))
            return await filing_digest_service.report(db, tickers, days=max(7, min(120, days)))

    @server.tool()
    async def get_xray(portfolio_id: str, currency: str | None = None) -> dict[str, Any]:
        """ETF look-through: true exposure per company and sector counting funds' holdings, the overlap between
        funds, and concentration as held vs looking through. Fund holdings can be partial (see each fund's
        `covered_weight`, `source` and `as_of`), so exposures are minimums. Stored data only: the app refreshes
        it weekly and when the ETF X-ray tab is opened."""
        from app.models.user import User
        from app.services import fund_lookthrough_service

        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            await _own_portfolio(db, user_id, portfolio_id)
            user = await db.get(User, user_id)
            return await fund_lookthrough_service.build_report(
                db, uuid.UUID(portfolio_id), display_currency=_display_ccy(currency, user)
            )

    @server.tool()
    async def get_tax_report(portfolio_id: str, year: int | None = None, min_loss: float = 100.0, currency: str | None = None) -> dict[str, Any]:
        """Tax view of a ledger-backed portfolio (informational, not tax advice; simplified US rules): realised
        gains for a tax year split short/long term with wash-sale adjustments, and open lots at a loss of at
        least `min_loss` (display currency) that could be harvested, with any wash-sale risk."""
        from app.routers.portfolio_tax import portfolio_tax

        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            await _own_portfolio(db, user_id, portfolio_id)
            user = await _user(db, user_id)
            return await portfolio_tax(uuid.UUID(portfolio_id), year=year, min_loss=min_loss, db=db, user=user,
                                       ccy=_display_ccy(currency, user))

    @server.tool()
    async def get_net_worth(range: str = "1y", currency: str | None = None) -> dict[str, Any]:  # noqa: A002
        """Household net worth: portfolios plus manually tracked assets (cash, property, private holdings,
        retirement accounts, crypto wallets) and liabilities (mortgages, loans, cards). Totals, the split by
        category, every item, and a series over `range` (6m, ytd, 1y, 3y, 5y)."""
        from app.routers.net_worth import net_worth

        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            user = await _user(db, user_id)
            return await net_worth(range=range, db=db, user=user, ccy=_display_ccy(currency, user))

    @server.tool()
    async def get_regime(ticker: str) -> dict[str, Any]:
        """Markov regime (Bull / Sideways / Bear) for a ticker, with signal, persistence and walk-forward stats."""
        from app.services.markov_service import get_regime as _get

        _caller()
        r = await _get(_ticker(ticker))
        if r is None:
            raise ToolError(f"No regime available for {ticker}")
        return {k: r.get(k) for k in ("ticker", "current_regime", "signal", "persistence", "stationary", "walk_forward",
                                      "transition_matrix") if k in r}

    @server.tool()
    async def list_runs(ticker: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        """The caller's recent AI analysis runs (optionally for one ticker), newest first."""
        from app.models.run import Run

        user_id, _ = _caller()
        limit = max(1, min(limit, 100))
        async with AsyncSessionLocal() as db:
            q = select(Run).where(Run.created_by == user_id)
            if ticker:
                q = q.where(Run.ticker == _ticker(ticker))
            runs = (await db.execute(q.order_by(desc(Run.created_at)).limit(limit))).scalars().all()
        return [{"id": str(r.id), "ticker": r.ticker, "analysis_date": r.analysis_date.isoformat() if r.analysis_date else None,
                 "status": r.status.value, "verdict": r.verdict.value if r.verdict else None,
                 "llm": f"{r.llm_provider}/{r.llm_model}", "depth": r.depth,
                 "created_at": r.created_at.isoformat() if r.created_at else None} for r in runs]

    @server.tool()
    async def get_run_report(run_id: str) -> dict[str, Any]:
        """The final report of a completed run: verdict, trader decision, entry/stop/target and risk assessment."""
        from app.models.report import Report
        from app.models.run import Run

        user_id, _ = _caller()
        try:
            rid = uuid.UUID(run_id)
        except ValueError as exc:
            raise ToolError("run_id must be a run id from list_runs") from exc
        async with AsyncSessionLocal() as db:
            run = (await db.execute(select(Run).where(Run.id == rid, Run.created_by == user_id))).scalar_one_or_none()
            if run is None:
                raise ToolError("Run not found")
            rep = (await db.execute(select(Report).where(Report.run_id == rid))).scalar_one_or_none()
        if rep is None:
            return {"id": run_id, "ticker": run.ticker, "status": run.status.value, "report": None}
        return {"id": run_id, "ticker": run.ticker, "analysis_date": run.analysis_date.isoformat() if run.analysis_date else None,
                "verdict": rep.verdict.value, "trader_decision": rep.trader_decision, "suggested_entry": rep.suggested_entry,
                "suggested_stop": rep.suggested_stop, "suggested_target": rep.suggested_target,
                "price_currency": rep.price_currency, "risk_assessment": rep.risk_assessment,
                "link": f"{base}/runs/{run_id}"}

    @server.tool()
    async def get_latest_insight(portfolio_id: str) -> dict[str, Any] | None:
        """The latest completed AI portfolio brief: health score, stance, summary, action items, risk alerts
        and the measured performance/risk figures it was given."""
        from app.models.portfolio_insight import InsightStatus, PortfolioInsight

        user_id, _ = _caller()
        async with AsyncSessionLocal() as db:
            await _own_portfolio(db, user_id, portfolio_id)
            ins = (await db.execute(
                select(PortfolioInsight).where(PortfolioInsight.portfolio_id == uuid.UUID(portfolio_id),
                                               PortfolioInsight.status == InsightStatus.completed)
                .order_by(desc(PortfolioInsight.generated_at)).limit(1))).scalar_one_or_none()
        if ins is None:
            return None
        return {"id": str(ins.id), "generated_at": ins.generated_at.isoformat(), "health_score": ins.health_score,
                "stance": ins.overall_stance.value if ins.overall_stance else None, "summary": ins.summary,
                "action_items": ins.action_items, "risk_alerts": ins.risk_alerts,
                "measured": (ins.holdings_snapshot or {}).get("measured")}

    @server.tool()
    async def list_alerts(limit: int = 20) -> dict[str, Any]:
        """The caller's alert rules and most recent alert events (read-only)."""
        from app.models.alert import AlertEvent, AlertRule
        from app.services.alert_rules import KINDS

        user_id, _ = _caller()
        limit = max(1, min(limit, 100))
        async with AsyncSessionLocal() as db:
            rules = (await db.execute(select(AlertRule).where(AlertRule.user_id == user_id))).scalars().all()
            events = (await db.execute(select(AlertEvent).where(AlertEvent.user_id == user_id)
                                       .order_by(desc(AlertEvent.triggered_at)).limit(limit))).scalars().all()
        return {
            "rules": [{"id": str(r.id), "kind": r.kind, "label": KINDS[r.kind].label if r.kind in KINDS else r.kind,
                       "ticker": r.ticker, "params": r.params, "enabled": r.enabled,
                       "last_triggered_at": r.last_triggered_at.isoformat() if r.last_triggered_at else None} for r in rules],
            "events": [{"title": e.title, "message": e.message, "triggered_at": e.triggered_at.isoformat(),
                        "read": e.read_at is not None} for e in events],
        }

    # ── research scope ────────────────────────────────────────────────────────

    @server.tool()
    async def start_analysis(ticker: str, depth: str = "quick", llm_provider: str | None = None,
                             llm_model: str | None = None) -> dict[str, Any]:
        """[research scope] Start a multi-agent AI analysis of a ticker. Returns the run id; poll list_runs and
        then call get_run_report once it completes. Uses the user's LLM keys (spends credits)."""
        from app.services.run_launcher import LaunchError, launch_run

        user_id = _require_research()
        sym = _ticker(ticker)
        async with AsyncSessionLocal() as db:
            user = await _user(db, user_id)
            try:
                run = await launch_run(db, user, sym, label="via MCP", depth=depth,
                                       llm_provider=llm_provider, llm_model=llm_model)
            except LaunchError as exc:
                raise ToolError(str(exc)) from exc
        return {"run_id": str(run.id), "ticker": sym, "status": "running", "llm": f"{run.llm_provider}/{run.llm_model}",
                "link": f"{base}/runs/{run.id}/live"}

    @server.tool()
    async def generate_portfolio_insight(portfolio_id: str, llm_provider: str | None = None,
                                         llm_model: str | None = None) -> dict[str, Any]:
        """[research scope] Generate a fresh AI portfolio brief in the background. Returns the insight id; fetch it
        later with get_latest_insight. Uses the user's LLM keys (spends credits)."""
        import asyncio

        from app.models.portfolio_insight import InsightStatus, InsightTrigger, PortfolioInsight
        from app.services.llm_selection import pick_llm_for_user
        from app.services.portfolio_insight_runner import generate_portfolio_insight as _generate

        user_id = _require_research()
        async with AsyncSessionLocal() as db:
            p = await _own_portfolio(db, user_id, portfolio_id)
            user = await _user(db, user_id)
            busy = (await db.execute(select(PortfolioInsight.id).where(
                PortfolioInsight.portfolio_id == p.id,
                PortfolioInsight.status.in_([InsightStatus.pending, InsightStatus.running])))).first()
            if busy:
                raise ToolError("An insight for this portfolio is already being generated")
            if not llm_provider:
                picked = await pick_llm_for_user(db, user)
                if picked is None:
                    raise ToolError("No LLM provider key is configured; add one in Settings.")
                llm_provider, llm_model = picked
            ins = PortfolioInsight(portfolio_id=p.id, status=InsightStatus.pending, trigger=InsightTrigger.manual,
                                   llm_provider=llm_provider, llm_model=llm_model or "")
            db.add(ins)
            await db.commit()
            await db.refresh(ins)
        asyncio.create_task(_generate(str(ins.id)))
        return {"insight_id": str(ins.id), "status": "pending"}

    return server


mcp_server = build_server() if MCP_AVAILABLE else None


class McpDispatch:
    """ASGI middleware: hand `/mcp` to the MCP app and everything else to FastAPI.

    A Starlette Mount("/mcp") would only match `/mcp/...`, and a bare `/mcp` would
    then need a redirect that MCP clients may not follow for a POST."""

    def __init__(self, app, mcp_app=None):
        self.app = app
        self._mcp_app = mcp_app

    @property
    def mcp_app(self):
        if self._mcp_app is None and mcp_server is not None:
            self._mcp_app = mcp_server.streamable_http_app()
        return self._mcp_app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].rstrip("/") == "/mcp":
            if self.mcp_app is None:  # pragma: no cover
                from starlette.responses import JSONResponse

                await JSONResponse({"detail": "MCP is not available on this server"}, status_code=503)(scope, receive, send)
                return
            scope = {**scope, "path": "/mcp"}
            await self.mcp_app(scope, receive, send)
            return
        await self.app(scope, receive, send)
