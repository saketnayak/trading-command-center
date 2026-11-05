"""Learning loop: the agents reflect on their own completed runs once the
outcome is known and write lessons into the run owner's memories.

- Opt-in per user (`users.learning_enabled`). Each user has their own
  TradingAgents results directory (`<results>/users/<user id>`), which holds
  the BM25 memories. Live runs read it only while the owner has learning on,
  so one user's lessons never steer another user's analyses.
- A completed run is due once `learning_horizon_days` (7 or 30) calendar days
  have passed. Its outcome comes from the keyless price store, not Finnhub:
  the close on or before the analysis date against the close on or before the
  date plus the horizon. BUY scores the move, SELL its inverse, HOLD zero
  (like the backtest harness); the stock's own move is passed as context.
- The agent state is rebuilt from `Report.raw_report` (without the chat
  messages, which reflection doesn't read). Reflection calls the run's own
  provider and model, five calls per run, so it spends the user's credits;
  each pass handles at most `MAX_PER_PASS` runs per user, oldest first.
- Every run is reflected on at most once (`run_reflections`, one row per run); a failed
  attempt is retried on later passes, up to `MAX_ATTEMPTS`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.run import Run, RunStatus
from app.models.run_reflection import RunReflection
from app.models.user import User

logger = logging.getLogger(__name__)

HORIZONS = (7, 30)
MAX_PER_PASS = 10
MAX_ATTEMPTS = 3  # a failed reflection (API error, missing key) is retried on later passes
MEMORY_NAMES = ("bull_memory", "bear_memory", "trader_memory", "invest_judge_memory", "risk_manager_memory")
_pass_lock = asyncio.Lock()


def results_root() -> Path:
    return Path(os.environ.get("TRADINGAGENTS_RESULTS_DIR", "./results"))


def user_results_dir(user_id) -> Path:
    return results_root() / "users" / str(user_id)


def memory_dir(user_id) -> Path:
    # Mirrors TradingAgentsGraph._memory_path: <results_dir>/data_cache/memories/<name>.jsonl
    return user_results_dir(user_id) / "data_cache" / "memories"


def memory_counts(user_id) -> dict[str, int]:
    out = {}
    for name in MEMORY_NAMES:
        path = memory_dir(user_id) / f"{name}.jsonl"
        try:
            with path.open(encoding="utf-8") as fh:
                out[name] = sum(1 for line in fh if line.strip())
        except FileNotFoundError:
            out[name] = 0
    return out


def clear_memories(user_id) -> None:
    shutil.rmtree(memory_dir(user_id), ignore_errors=True)


def _close_on_or_before(closes: dict[date, float], d: date, max_back: int = 7) -> tuple[date, float] | None:
    for back in range(max_back + 1):
        day = d - timedelta(days=back)
        if day in closes:
            return day, closes[day]
    return None


def outcome(closes: dict[date, float], verdict: str, analysis_date: date, horizon_days: int) -> dict | None:
    """Pure: entry/exit around the horizon and the direction-signed return, or None without prices."""
    entry = _close_on_or_before(closes, analysis_date)
    exit_ = _close_on_or_before(closes, analysis_date + timedelta(days=horizon_days))
    if not entry or not exit_ or entry[1] <= 0 or exit_[0] <= entry[0]:
        return None
    move = exit_[1] / entry[1] - 1
    v = (verdict or "").lower()
    signed = move if v == "buy" else -move if v == "sell" else 0.0
    return {"entry_date": entry[0], "entry_price": entry[1], "exit_date": exit_[0], "exit_price": exit_[1],
            "stock_return": move, "realised_return": signed}


def ta_config(run_cfg: dict):
    """The TradingAgents config a reflection uses: the run's provider, model and depth,
    with the owner's results directory (where their memories live)."""
    from tradingagents.config import TradingAgentsConfig

    from app.services.trading_agent_runner import _DEPTH_PARAMS, _PROVIDER_MAP

    return TradingAgentsConfig(
        results_dir=run_cfg["results_dir"],
        llm_provider=_PROVIDER_MAP.get(run_cfg["provider"], run_cfg["provider"]),
        deep_think_llm=run_cfg["model"],
        quick_think_llm=run_cfg["model"],
        **_DEPTH_PARAMS.get(run_cfg.get("depth") or "standard", _DEPTH_PARAMS["standard"]),
    )


def _reflect(run_cfg: dict, raw_state: dict, out: dict) -> dict:
    """Blocking: rebuild the state and reflect into the user's memories. The seam tests replace."""
    from tradingagents.agents.utils.agent_states import AgentState
    from tradingagents.graph.reflection import ReflectionOutcomeContext
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    state = AgentState.model_validate({k: v for k, v in raw_state.items() if k != "messages"})
    config = ta_config(run_cfg)
    graph = TradingAgentsGraph(config=config)
    scores = graph.reflect_and_remember(
        out["realised_return"],
        state=state,
        outcome_context=ReflectionOutcomeContext(
            entry_price=out["entry_price"], exit_price=out["exit_price"], exit_date=out["exit_date"].isoformat(),
            horizon_days=run_cfg["horizon_days"], benchmark_returns={"buy_and_hold": out["stock_return"]},
        ),
    )
    return {k: (v.model_dump() if hasattr(v, "model_dump") else v) for k, v in scores.items() if v is not None}


async def due_runs(db: AsyncSession, user: User, today: date, limit: int = MAX_PER_PASS) -> list[Run]:
    """Completed runs past the horizon that have no reflection yet, or whose earlier attempts failed."""
    cutoff = today - timedelta(days=user.learning_horizon_days)
    settled = select(RunReflection.run_id).where(
        (RunReflection.status != "failed") | (RunReflection.attempts >= MAX_ATTEMPTS))
    q = (select(Run).options(selectinload(Run.report))
         .where(Run.created_by == user.id, Run.status == RunStatus.completed, Run.analysis_date <= cutoff,
                Run.id.not_in(settled))
         .order_by(Run.analysis_date, Run.created_at).limit(limit))
    return list((await db.execute(q)).scalars().all())


async def reflect_for_user(user_id, limit: int = MAX_PER_PASS) -> dict:
    """One pass for one user: reflect on up to `limit` due runs. Returns counts by status."""
    from app.services.price_history_service import get_closes
    from app.services.trading_agent_runner import _env_fallback_lock, _get_stored_key, provider_env

    counts = {"done": 0, "failed": 0, "skipped": 0}
    today = datetime.now(timezone.utc).date()
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        if user is None or not user.learning_enabled:
            return counts
        horizon = user.learning_horizon_days
        runs = await due_runs(db, user, today, limit)
        for run in runs:
            row = await db.get(RunReflection, run.id)
            if row is None:
                row = RunReflection(run_id=run.id, user_id=user.id, attempts=0)
                db.add(row)
            row.attempts += 1
            row.horizon_days, row.status, row.error, row.scores = horizon, "skipped", None, None
            raw = run.report.raw_report if run.report else None
            sym = run.ticker.strip().upper()
            closes, _ = await get_closes(db, [sym], run.analysis_date - timedelta(days=10),
                                         run.analysis_date + timedelta(days=horizon + 1))
            out = outcome(closes.get(sym, {}), run.verdict.value if run.verdict else "", run.analysis_date, horizon)
            if not raw:
                row.error = "This run has no saved agent state to reflect on."
            elif out is None:
                row.error = f"No prices for {run.ticker} around {run.analysis_date} and {horizon} days later."
            else:
                row.realised_return, row.benchmark_return = out["realised_return"], out["stock_return"]
                env = provider_env(run.llm_provider, await _get_stored_key(run.llm_provider))
                cfg = {"results_dir": str(user_results_dir(user.id)), "provider": run.llm_provider,
                       "model": run.llm_model, "depth": run.depth, "horizon_days": horizon}
                try:
                    async with (_env_fallback_lock if env else asyncio.Lock()):
                        previous = {k: os.environ.get(k) for k in env}
                        os.environ.update(env)
                        try:
                            row.scores = await asyncio.to_thread(_reflect, cfg, raw, out)
                        finally:
                            for k, v in previous.items():
                                if v is None:
                                    os.environ.pop(k, None)
                                else:
                                    os.environ[k] = v
                    row.status = "done"
                except Exception as exc:  # noqa: BLE001 - recorded on the row; the run is not retried
                    logger.warning("reflection failed for run %s", run.id, exc_info=True)
                    row.status, row.error = "failed", f"{type(exc).__name__}: {str(exc)[:400]}"
            counts[row.status] += 1
            await db.commit()
    return counts


async def run_learning_pass() -> None:
    """Scheduler job: one pass for every user with learning on. Overlapping passes skip."""
    if _pass_lock.locked():
        return
    async with _pass_lock:
        async with AsyncSessionLocal() as db:
            ids = (await db.execute(select(User.id).where(User.learning_enabled.is_(True)))).scalars().all()
        for uid in ids:
            try:
                counts = await reflect_for_user(uid)
                if any(counts.values()):
                    logger.info("learning pass for %s: %s", uid, counts)
            except Exception:  # noqa: BLE001 - one user must not stop the rest
                logger.warning("learning pass failed for %s", uid, exc_info=True)


async def live_results_dir(run_id: str) -> str | None:
    """The results directory a live run should use: the owner's own one when learning is on."""
    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(User).join(Run, Run.created_by == User.id).where(Run.id == run_id))).scalar_one_or_none()
    if owner is not None and owner.learning_enabled:
        return str(user_results_dir(owner.id))
    return None
