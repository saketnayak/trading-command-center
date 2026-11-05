"""Runs TradingAgents backtests (tradingagents.backtest.Backtester) in the background.

- One backtest runs at a time on this server (they are long and LLM-heavy);
  others wait as `pending`.
- The harness runs in a thread. Each finished decision goes through
  `on_trade`, which records it and is where an abort request takes effect,
  so an abort lands after the decision in flight.
- Each backtest gets its own TradingAgents results directory, so the
  agents' walk-forward reflections (memory) stay inside that backtest and
  never leak into live runs. The directory is deleted afterwards.
- Real runs need the provider's stored key and patch the same environment
  variables as live runs, under the same lock.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from typing import Callable

from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models.backtest import Backtest
from app.services.backtest_calc import build_report

logger = logging.getLogger(__name__)

_tasks: dict[str, asyncio.Task] = {}
_abort_requested: set[str] = set()
_one_at_a_time = asyncio.Lock()
PROGRESS_EVERY_S = 3.0


class _Aborted(Exception):
    pass


def _trade_dict(record) -> dict:
    rec = record.recommendation
    return {
        "ticker": record.ticker,
        "decision_date": record.decision_date,
        "split": record.dataset_split,
        "signal": getattr(rec, "signal", "HOLD"),
        "size_fraction": getattr(rec, "size_fraction", None),
        "confidence": getattr(rec, "confidence", None),
        "rationale": (getattr(rec, "rationale", "") or "")[:400],
        "entry_price": record.entry_price,
        "exit_date": record.exit_date,
        "exit_price": record.exit_price,
        "realised_return": record.realised_return,
        "benchmark_returns": dict(record.benchmark_returns or {}),
        "notes": record.notes or "",
    }


def _run_harness(cfg: dict, results_dir: str, on_trade: Callable[[dict], None]) -> dict:
    """Blocking: build the TradingAgents configs, run the Backtester and return its totals.
    The seam tests replace."""
    from tradingagents.backtest import Backtester, BacktestConfig
    from tradingagents.config import TradingAgentsConfig

    from app.services.trading_agent_runner import _DEPTH_PARAMS, _PROVIDER_MAP

    ta_config = TradingAgentsConfig(
        results_dir=results_dir,
        llm_provider=_PROVIDER_MAP.get(cfg["llm_provider"], cfg["llm_provider"]),
        deep_think_llm=cfg["llm_model"],
        quick_think_llm=cfg["llm_model"],
        selected_analysts=cfg["analysts"],
        **_DEPTH_PARAMS.get(cfg["depth"], _DEPTH_PARAMS["quick"]),
    )
    bt = BacktestConfig(
        tickers=cfg["tickers"],
        start_date=cfg["start_date"],
        end_date=cfg["end_date"],
        frequency=cfg["frequency"],
        horizon_days=cfg["horizon_days"],
        budget_cap_usd=None if cfg["dry_run"] else cfg["budget_usd"],
        dry_run=cfg["dry_run"],
        reflect_after_each_trade=cfg.get("reflect", True),
        walk_forward=True,
        trading_config=ta_config,
    )
    report = Backtester(config=bt).run(on_trade=lambda record: on_trade(_trade_dict(record)))
    return {
        "estimated_cost_usd": report.estimated_cost_usd,
        "warning_rate": report.warning_rate,
        "model_names": report.model_names,
        "harness": {"sharpe": report.sharpe, "hit_rate": report.hit_rate, "total_return": report.total_return,
                    "worst_drawdown": report.worst_drawdown},
    }


async def _save(backtest_id: str, **values) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(update(Backtest).where(Backtest.id == backtest_id).values(**values))
        await db.commit()


async def _execute(backtest_id: str) -> None:
    async with _one_at_a_time:
        if backtest_id in _abort_requested:
            _abort_requested.discard(backtest_id)
            await _save(backtest_id, status="aborted", completed_at=datetime.now(timezone.utc))
            return
        async with AsyncSessionLocal() as db:
            bt = await db.get(Backtest, backtest_id)
            if bt is None:
                return
            cfg = dict(bt.config)
        await _save(backtest_id, status="running", started_at=datetime.now(timezone.utc))

        trades: list[dict] = []

        def on_trade(row: dict) -> None:
            trades.append(row)
            if backtest_id in _abort_requested:
                raise _Aborted()

        results_dir = tempfile.mkdtemp(prefix=f"backtest-{backtest_id}-")
        env: dict[str, str] = {}
        if not cfg["dry_run"]:
            from app.services.trading_agent_runner import _get_stored_key, provider_env
            env = provider_env(cfg["llm_provider"], await _get_stored_key(cfg["llm_provider"]))

        async def progress() -> None:
            saved = 0
            while True:
                await asyncio.sleep(PROGRESS_EVERY_S)
                if len(trades) != saved:
                    saved = len(trades)
                    await _save(backtest_id, trades=list(trades))

        progress_task = asyncio.create_task(progress())
        status, error, totals = "completed", None, {}
        try:
            from app.services.tradingagents_grounding import (
                apply_analyst_specific_grounding_patch,
                apply_reasoning_effort_patch,
            )
            apply_analyst_specific_grounding_patch()
            apply_reasoning_effort_patch()
            from app.services.trading_agent_runner import _env_fallback_lock

            async with (_env_fallback_lock if env else asyncio.Lock()):
                previous = {k: os.environ.get(k) for k in env}
                os.environ.update(env)
                try:
                    totals = await asyncio.to_thread(_run_harness, cfg, results_dir, on_trade)
                finally:
                    for k, v in previous.items():
                        if v is None:
                            os.environ.pop(k, None)
                        else:
                            os.environ[k] = v
            if len(trades) < cfg["total_decisions"] and not cfg["dry_run"]:
                status = "stopped"
                error = f"Stopped by the ${cfg['budget_usd']:g} budget cap after {len(trades)} of {cfg['total_decisions']} decisions."
        except _Aborted:
            status, error = "aborted", f"Stopped by you after {len(trades)} of {cfg['total_decisions']} decisions."
        except Exception as exc:  # noqa: BLE001 - recorded on the backtest
            logger.exception("backtest %s failed", backtest_id)
            status, error = "failed", f"{type(exc).__name__}: {str(exc)[:500]}"
        finally:
            progress_task.cancel()
            _abort_requested.discard(backtest_id)
            shutil.rmtree(results_dir, ignore_errors=True)

        report = build_report(trades, cfg["frequency"], cfg.get("training_cutoff")) if trades else None
        if report is not None:
            report["warning_rate"] = totals.get("warning_rate")
            report["model_names"] = totals.get("model_names")
        await _save(backtest_id, status=status, error=error, trades=trades, report=report,
                    cost_usd=float(totals.get("estimated_cost_usd") or 0.0), completed_at=datetime.now(timezone.utc))


def start_backtest(backtest_id: str) -> None:
    task = asyncio.create_task(_execute(backtest_id))
    _tasks[backtest_id] = task
    task.add_done_callback(lambda _: _tasks.pop(backtest_id, None))


def request_abort(backtest_id: str) -> bool:
    """Ask a pending or running backtest to stop after its current decision."""
    if backtest_id in _tasks:
        _abort_requested.add(backtest_id)
        return True
    return False


def is_active(backtest_id: str) -> bool:
    return backtest_id in _tasks


async def recover_interrupted_backtests() -> None:
    """On boot, backtests that were pending or running belong to a dead process."""
    try:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(Backtest).where(Backtest.status.in_(("pending", "running"))))).scalars().all()
            for bt in rows:
                bt.status = "interrupted"
                bt.error = "The server restarted while this backtest was running."
                bt.completed_at = datetime.now(timezone.utc)
                if bt.trades:
                    bt.report = build_report(bt.trades, bt.config.get("frequency", "weekly"), bt.config.get("training_cutoff"))
            await db.commit()
    except Exception:  # noqa: BLE001 - never block boot
        logger.warning("backtest recovery failed", exc_info=True)
