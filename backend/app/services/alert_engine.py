"""Alert engine: fetch observations, evaluate rules, record and deliver events.

`evaluate_all_alerts` is the scheduler job (every 15 minutes). `check_rule`
is the dry run behind "Check now": it evaluates against current data and
changes nothing. Observations come from a MarketData object, cached for the
duration of one pass, so N rules on the same ticker cost one fetch. Tests
pass their own MarketData.
"""

from __future__ import annotations

import asyncio
import html
import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.alert import AlertEvent, AlertRule
from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.portfolio_delivery_settings import PortfolioDeliverySettings
from app.models.run import Run, RunStatus
from app.models.user import User
from app.services import alert_compound, alert_rules

logger = logging.getLogger(__name__)

MAX_SCOPE_TICKERS = 60  # holdings a compound rule checks per pass
MAX_RERUNS_PER_EVENT = 3
RERUN_RECENT = timedelta(hours=20)  # a run this recent is linked instead of starting another

_http = httpx.AsyncClient(timeout=10.0)
# One pass at a time (single uvicorn worker, like job_manager). A pass that
# overran the 15-minute interval must not race a second one over the same
# rule state, or both would fire the same transition.
_pass_lock = asyncio.Lock()


class MarketData:
    """Live observations for each rule kind. One instance per evaluation pass."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._cache: dict[tuple, object] = {}

    async def _cached(self, key: tuple, factory):
        if key not in self._cache:
            self._cache[key] = await factory()
        return self._cache[key]

    async def quote(self, ticker: str) -> dict | None:
        from app.services.yfinance_service import fetch_quote

        return await self._cached(("quote", ticker), lambda: fetch_quote(ticker))

    async def moving_average(self, ticker: str, window: int) -> dict | None:
        from app.services.price_history_service import get_closes

        async def _load():
            today = datetime.now(timezone.utc).date()
            closes, _ = await get_closes(self.db, [ticker], today - timedelta(days=window * 2 + 30), today)
            series = sorted(closes.get(ticker, {}).items())
            if len(series) < window:
                return None
            last = [c for _, c in series[-window:]]
            return {"close": series[-1][1], "sma": sum(last) / window, "date": series[-1][0].isoformat()}

        return await self._cached(("sma", ticker, window), _load)

    async def regime(self, ticker: str) -> dict | None:
        from app.services.markov_service import get_regime

        async def _load():
            r = await get_regime(ticker)
            return {"regime": r["current_regime"]} if r and r.get("current_regime") else None

        return await self._cached(("regime", ticker), _load)

    async def verdict(self, user_id, ticker: str) -> dict | None:
        async def _load():
            run = (
                await self.db.execute(
                    select(Run)
                    .where(Run.created_by == user_id, Run.ticker == ticker,
                           Run.status == RunStatus.completed, Run.verdict.isnot(None))
                    .order_by(desc(Run.created_at))
                    .limit(1)
                )
            ).scalar_one_or_none()
            if run is None:
                return None
            return {"run_id": str(run.id), "verdict": run.verdict.value,
                    "analysis_date": run.analysis_date.isoformat() if run.analysis_date else None}

        return await self._cached(("verdict", str(user_id), ticker), _load)

    async def holdings(self, portfolio_id) -> list[str] | None:
        """Tickers in the portfolio's latest snapshot (None: no snapshot)."""
        from sqlalchemy.orm import selectinload

        from app.services.portfolio_pricing import aggregate_shares

        async def _load():
            snap = (await self.db.execute(
                select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == portfolio_id)
                .options(selectinload(PortfolioSnapshot.holdings))
                .order_by(desc(PortfolioSnapshot.uploaded_at)).limit(1)
            )).scalar_one_or_none()
            return sorted(aggregate_shares(snap.holdings)) if snap else None

        return await self._cached(("holdings", str(portfolio_id)), _load)

    async def sectors(self, tickers: list[str]) -> dict[str, tuple[str | None, str | None]]:
        """(sector, industry) per ticker from the ticker_metadata cache (refreshed when stale)."""
        from app.services.finnhub_client import get_finnhub_key
        from app.services.ticker_metadata_service import get_many_ticker_metadata

        missing = [t for t in tickers if ("sector", t) not in self._cache]
        if missing:
            try:
                rows = await get_many_ticker_metadata(missing, self.db, await get_finnhub_key(self.db))
            except Exception as exc:  # noqa: BLE001 - unknown sectors are reported, not fatal
                logger.warning("alerts: sector lookup failed: %s", exc)
                rows = {}
            for t in missing:
                row = rows.get(t)
                self._cache[("sector", t)] = (row.sector, row.industry) if row else (None, None)
        return {t: self._cache[("sector", t)] for t in tickers}

    async def _performance(self, portfolio_id, currency: str) -> dict | None:
        from app.services.portfolio_performance_service import build_performance_report

        return await self._cached(
            ("perf", str(portfolio_id), currency),
            lambda: build_performance_report(self.db, portfolio_id, display_currency=currency),
        )

    async def drawdown(self, portfolio_id, currency: str) -> dict | None:
        perf = await self._performance(portfolio_id, currency)
        series = (perf or {}).get("series") or []
        if not series:
            return None
        peak = max(series, key=lambda p: p["index"])
        return {"drawdown": series[-1]["drawdown"], "peak_date": peak["date"]}

    async def weights(self, portfolio_id, currency: str) -> dict | None:
        perf = await self._performance(portfolio_id, currency)
        holdings = (perf or {}).get("holdings") or []
        weights = {h["ticker"]: h["weight"] for h in holdings if h.get("weight") is not None and h.get("shares")}
        return {"weights": weights} if weights else None


async def _reading(rule: AlertRule, data: MarketData, currency: str, key: str, t: str):
    if key == "quote":
        q = await data.quote(t)
        return ({"price": q["price"], "change_pct": q.get("change_pct"), "prev_close": q.get("prev_close")}
                if q and q.get("price") else None)
    if key in ("ma50", "ma200"):
        return await data.moving_average(t, int(key[2:]))
    if key == "regime":
        r = await data.regime(t)
        return r["regime"] if r else None
    if key == "verdict":
        v = await data.verdict(rule.user_id, t)
        return v["verdict"] if v else None
    if key == "weight":
        if rule.portfolio_id is None:
            return None
        w = await data.weights(rule.portfolio_id, currency)
        return (w["weights"].get(t, 0.0)) if w else None
    return None


async def observe_compound(rule: AlertRule, data: MarketData, currency: str) -> dict | None:
    """Readings per ticker in scope. Readings are fetched cheapest first, and a ticker
    stops fetching once its AND/OR outcome is decided. Network-only readings (quotes,
    regimes) are fetched concurrently across tickers; DB readings one at a time."""
    params = rule.params
    excluded: list[str] = []
    if params.get("scope") == "holdings":
        if rule.portfolio_id is None:
            return None
        tickers = await data.holdings(rule.portfolio_id)
        if tickers is None:
            return None
        if params.get("sectors"):
            meta = await data.sectors(tickers)
            keep = [t for t in tickers if alert_compound.sector_matches(*meta.get(t, (None, None)), params["sectors"])]
            excluded = [t for t in tickers if t not in keep]
            tickers = keep
        tickers = tickers[:MAX_SCOPE_TICKERS]
    else:
        tickers = [rule.ticker] if rule.ticker else []

    op, conditions = params.get("op", "and"), params["conditions"]
    needed = {alert_compound.reading_key(c) for c in conditions}
    keys = [k for k in alert_compound.FETCH_ORDER if k in needed]
    readings: dict[str, dict] = {t: {} for t in tickers}

    def undecided(t: str) -> bool:
        r = readings[t]
        results = [alert_compound.check_condition(c, r)[0] for c in conditions if alert_compound.reading_key(c) in r]
        return not alert_compound.decided(op, results)

    for key in keys:
        todo = [t for t in tickers if undecided(t)]
        if key in ("quote", "regime"):
            got = await asyncio.gather(*(_reading(rule, data, currency, key, t) for t in todo), return_exceptions=True)
            for t, v in zip(todo, got):
                readings[t][key] = None if isinstance(v, BaseException) else v
        else:
            for t in todo:
                readings[t][key] = await _reading(rule, data, currency, key, t)
    return {"readings": readings, "excluded": excluded}


async def observe(rule: AlertRule, data: MarketData, currency: str) -> dict | None:
    kind, t = rule.kind, rule.ticker
    if kind == "compound":
        return await observe_compound(rule, data, currency)
    if kind in ("price_above", "price_below", "daily_move"):
        q = await data.quote(t)
        return ({"price": q["price"], "change_pct": q.get("change_pct"), "prev_close": q.get("prev_close")}
                if q and q.get("price") else None)
    if kind == "ma_cross":
        return await data.moving_average(t, int(rule.params["window"]))
    if kind == "regime_change":
        return await data.regime(t)
    if kind == "verdict_change":
        return await data.verdict(rule.user_id, t)
    if kind == "portfolio_drawdown":
        return await data.drawdown(rule.portfolio_id, currency)
    if kind == "position_weight":
        return await data.weights(rule.portfolio_id, currency)
    return None


async def _context(db: AsyncSession, rule: AlertRule) -> tuple[User | None, Portfolio | None]:
    user = await db.get(User, rule.user_id)
    portfolio = await db.get(Portfolio, rule.portfolio_id) if rule.portfolio_id else None
    return user, portfolio


async def check_rule(db: AsyncSession, rule: AlertRule, data: MarketData | None = None) -> alert_rules.Evaluation:
    """Dry run: evaluate against current data without saving state or firing."""
    data = data or MarketData(db)
    user, portfolio = await _context(db, rule)
    currency = (user.preferred_currency if user else "USD").upper()
    observed = await observe(rule, data, currency)
    return alert_rules.evaluate(rule.kind, rule.params, observed, rule.state, ticker=rule.ticker,
                                portfolio_name=portfolio.name if portfolio else None,
                                today=datetime.now(timezone.utc).date())


async def evaluate_rule(db: AsyncSession, rule: AlertRule, data: MarketData, now: datetime) -> AlertEvent | None:
    """Evaluate one rule, persist its new state, and record (not deliver) an event if it fires."""
    user, portfolio = await _context(db, rule)
    currency = (user.preferred_currency if user else "USD").upper()
    try:
        observed = await observe(rule, data, currency)
        ev = alert_rules.evaluate(rule.kind, rule.params, observed, rule.state, ticker=rule.ticker,
                                  portfolio_name=portfolio.name if portfolio else None, today=now.date())
    except Exception as exc:  # noqa: BLE001 - one bad rule must not stop the pass
        logger.warning("alert rule %s failed: %s", rule.id, exc)
        rule.last_error = f"{type(exc).__name__}: {exc}"[:500]
        rule.last_checked_at = now
        return None

    rule.last_checked_at = now
    rule.last_error = None if ev.condition is not None else ev.observed
    rule.state = ev.state
    if not ev.fire:
        return None
    if rule.last_triggered_at and now - rule.last_triggered_at < timedelta(hours=rule.cooldown_hours):
        return None  # cooling down: the transition is consumed without a notification
    rule.last_triggered_at = now
    event = AlertEvent(
        id=uuid.uuid4(), rule_id=rule.id, user_id=rule.user_id, triggered_at=now, kind=rule.kind,
        ticker=rule.ticker, portfolio_id=rule.portfolio_id, title=ev.title[:200], message=ev.message,
        data=ev.data, delivery={"inbox": "delivered"},
    )
    db.add(event)
    return event


# ── delivery ──────────────────────────────────────────────────────────────────

def _base_url() -> str:
    return getattr(settings, "frontend_url", "http://localhost:3000").rstrip("/")


def _link(event: AlertEvent) -> str:
    base = _base_url()
    analyses = (event.data or {}).get("analyses") or []
    if analyses:
        return f"{base}/runs/{analyses[0]['run_id']}/live"
    if event.kind == "verdict_change" and (event.data or {}).get("run_id"):
        return f"{base}/runs/{event.data['run_id']}"
    if event.portfolio_id:
        return f"{base}/portfolio"
    return f"{base}/alerts"


def webhook_payload(fmt: str, event: AlertEvent, chat_id: str | None = None) -> dict:
    link = _link(event)
    if fmt == "slack":
        return {"text": f"*{event.title}*\n{event.message}\n<{link}|Open in AgentFloor>"}
    if fmt == "telegram":
        return {"chat_id": chat_id, "parse_mode": "HTML",
                "text": f"<b>{html.escape(event.title)}</b>\n{html.escape(event.message)}\n{html.escape(link)}"}
    return {"type": "alert", "id": str(event.id), "kind": event.kind, "ticker": event.ticker,
            "title": event.title, "message": event.message, "triggered_at": event.triggered_at.isoformat(),
            "data": event.data, "link": link}


async def _send_email(to: str, event: AlertEvent) -> None:
    import aiosmtplib
    from email.message import EmailMessage

    if not settings.smtp_host:
        logger.info("[email stub] alert for %s: %s", to, event.title)
        return
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = f"AgentFloor alert: {event.title}"
    msg.set_content(f"{event.message}\n\n{_link(event)}\n\nManage alerts: {_base_url()}/alerts\n")
    await aiosmtplib.send(msg, hostname=settings.smtp_host, port=settings.smtp_port,
                          username=settings.smtp_user or None, password=settings.smtp_password or None, start_tls=True)


async def rerun_analyses(db: AsyncSession, rule: AlertRule, event: AlertEvent) -> None:
    """The rule's optional action: start a fresh analysis for each ticker the event is
    about, at most MAX_RERUNS_PER_EVENT, linking a recent run instead of starting a
    duplicate. Records outcomes on the event. Research only: never an order. Never raises."""
    from app.services.run_launcher import LaunchError, launch_run

    outcome = dict(event.delivery or {})
    tickers = alert_rules.rule_tickers(rule.kind, event.data, rule.ticker)
    if not tickers:
        return
    user = await db.get(User, rule.user_id)
    now = datetime.now(timezone.utc)
    analyses: list[dict] = []
    started, problem = 0, None
    for t in tickers[:MAX_RERUNS_PER_EVENT]:
        recent = (await db.execute(
            select(Run).where(Run.created_by == rule.user_id, Run.ticker == t, Run.created_at >= now - RERUN_RECENT,
                              Run.status.in_([RunStatus.pending, RunStatus.running, RunStatus.completed]))
            .order_by(desc(Run.created_at)).limit(1)
        )).scalar_one_or_none()
        if recent is not None:
            analyses.append({"ticker": t, "run_id": str(recent.id), "source": "recent"})
            continue
        try:
            run = await launch_run(db, user, t, label="via alert")
        except LaunchError as exc:
            problem = f"skipped: {exc}"
            break
        except Exception as exc:  # noqa: BLE001
            logger.warning("alerts: re-run for %s failed: %s", t, exc)
            problem = f"failed: {exc}"[:300]
            break
        analyses.append({"ticker": t, "run_id": str(run.id), "source": "started"})
        started += 1
    skipped = len(tickers) - MAX_RERUNS_PER_EVENT
    parts = []
    if started:
        parts.append(f"started {started}")
    if len(analyses) > started:
        parts.append(f"linked {len(analyses) - started} recent")
    if skipped > 0:
        parts.append(f"{skipped} over the limit of {MAX_RERUNS_PER_EVENT}")
    outcome["analysis"] = problem or ("; ".join(parts) if parts else "nothing to run")
    if problem and parts:
        outcome["analysis"] = f"{'; '.join(parts)}; then {problem}"
    event.delivery = outcome
    if analyses:
        event.data = {**(event.data or {}), "analyses": analyses}


async def deliver(db: AsyncSession, rule: AlertRule, event: AlertEvent) -> None:
    """Email and webhook delivery; outcomes recorded on the event. Never raises."""
    if rule.rerun_analysis:
        await rerun_analyses(db, rule, event)  # first, so messages can link the new runs
    outcome = dict(event.delivery or {})
    channels = set(rule.channels or [])
    if "email" in channels:
        user = await db.get(User, rule.user_id)
        try:
            await _send_email(user.email, event)
            outcome["email"] = "sent" if settings.smtp_host else "skipped: SMTP not configured"
        except Exception as exc:  # noqa: BLE001
            outcome["email"] = f"failed: {exc}"[:300]
    if "webhook" in channels:
        cfg = None
        if rule.portfolio_id:
            cfg = (await db.execute(select(PortfolioDeliverySettings).where(
                PortfolioDeliverySettings.portfolio_id == rule.portfolio_id))).scalar_one_or_none()
        if not cfg or not cfg.webhook_enabled or not cfg.webhook_url:
            outcome["webhook"] = "skipped: the portfolio has no webhook enabled"
        else:
            try:
                resp = await _http.post(cfg.webhook_url, json=webhook_payload(cfg.webhook_format, event, cfg.telegram_chat_id))
                outcome["webhook"] = "sent" if resp.is_success else f"failed: HTTP {resp.status_code}"
            except Exception as exc:  # noqa: BLE001
                outcome["webhook"] = f"failed: {exc}"[:300]
    event.delivery = outcome


async def evaluate_all_alerts(data_factory=MarketData) -> dict:
    """Scheduler job: evaluate every enabled rule once, then deliver what fired.
    Skips (returns skipped=True) while a previous pass is still running."""
    if _pass_lock.locked():
        logger.warning("alerts: previous pass still running; skipping this one")
        return {"checked": 0, "fired": 0, "skipped": True}
    async with _pass_lock:
        return await _evaluate_all(data_factory)


async def _evaluate_all(data_factory) -> dict:
    now = datetime.now(timezone.utc)
    fired = 0
    async with AsyncSessionLocal() as db:
        rules = (await db.execute(select(AlertRule).where(AlertRule.enabled.is_(True)))).scalars().all()
        data = data_factory(db)
        # Warm quotes concurrently: they are the most common and the slowest observation.
        quote_tickers = {r.ticker for r in rules if r.kind in ("price_above", "price_below", "daily_move") and r.ticker}
        await asyncio.gather(*(data.quote(t) for t in quote_tickers), return_exceptions=True)
        pending: list[tuple[AlertRule, AlertEvent]] = []
        for rule in rules:
            event = await evaluate_rule(db, rule, data, now)
            if event is not None:
                pending.append((rule, event))
        await db.commit()
        for rule, event in pending:
            await deliver(db, rule, event)
            fired += 1
        await db.commit()
    if rules:
        logger.info("alerts: %d rules checked, %d fired", len(rules), fired)
    return {"checked": len(rules), "fired": fired}
