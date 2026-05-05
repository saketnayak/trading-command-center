import asyncio
import os
import re
from queue import Queue as SyncQueue
from datetime import datetime, timezone
from langchain_core.callbacks import BaseCallbackHandler

# Serializes env-var patching so concurrent local-inference runs don't race on os.environ.
_env_fallback_lock = asyncio.Lock()

AGENT_NODES = {
    "market_analyst", "social_analyst", "news_analyst",
    "fundamentals_analyst", "technical_analyst",
    "bull_researcher", "bear_researcher",
    "trader",
    "aggressive_analyst", "conservative_analyst", "neutral_analyst",
    "risk_judge",
}

# Maps AgentFloor provider names to TradingAgentsConfig llm_provider literals.
_PROVIDER_MAP: dict[str, str] = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google_genai",
    "ollama": "ollama",
    "vllm": "openai",  # vLLM is OpenAI-compatible
}

_DEPTH_PARAMS: dict[str, dict] = {
    "quick":    {"max_debate_rounds": 1, "max_risk_discuss_rounds": 1, "max_recur_limit": 75},
    "standard": {"max_debate_rounds": 2, "max_risk_discuss_rounds": 2, "max_recur_limit": 150},
    "deep":     {"max_debate_rounds": 3, "max_risk_discuss_rounds": 3, "max_recur_limit": 200},
}


class _SyncEmitter(BaseCallbackHandler):
    """Sync LangChain callback that enqueues events into a thread-safe queue."""

    def __init__(self, queue: SyncQueue):
        self._q = queue
        self._current: str | None = None

    def on_chain_start(self, serialized, inputs, **kwargs):
        name = (kwargs.get("name") or "").lower().replace(" ", "_")
        if name in AGENT_NODES:
            self._current = name
            self._q.put_nowait({"type": "started", "agent": name})

    def on_llm_new_token(self, token: str, **kwargs):
        if self._current:
            self._q.put_nowait({"type": "token", "agent": self._current, "token": token})

    def on_chain_end(self, outputs, **kwargs):
        if self._current:
            summary = str(outputs)[:500] if outputs else ""
            self._q.put_nowait({"type": "completed", "agent": self._current, "summary": summary})
            self._current = None

    def on_chain_error(self, error, **kwargs):
        agent = self._current or ""
        self._q.put_nowait({"type": "error", "agent": agent, "message": str(error)})
        self._current = None


_CLOUD_KEY_ENV: dict[str, str] = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
}


async def _get_stored_key(provider: str) -> str | None:
    """Return the decrypted stored API key for any provider, or None."""
    from app.database import AsyncSessionLocal
    from app.models.api_key import ApiKey
    from app.services.encryption import decrypt_key
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(ApiKey).where(ApiKey.provider == provider))).scalar_one_or_none()
    if not row:
        return None
    return decrypt_key(row.encrypted_key)


async def execute_run(run_id: str, config: dict) -> None:
    from app.database import AsyncSessionLocal
    from app.models.run import Run, RunStatus, RunVerdict
    from app.models.agent_event import AgentEvent, EventType
    from app.models.report import Report
    from app.services.websocket_manager import ws_manager

    sync_q: SyncQueue = SyncQueue()
    async_q: asyncio.Queue = asyncio.Queue()
    sequence = [0]

    async def _drain():
        while True:
            await asyncio.sleep(0.05)
            while not sync_q.empty():
                await async_q.put(sync_q.get_nowait())

    async def _process():
        while True:
            event = await async_q.get()
            if event is None:
                break
            await ws_manager.broadcast(run_id, event)
            # Token events are streamed live; skip persisting them to avoid
            # thousands of rows per run. Full output lives in Report.raw_report.
            if event.get("type") == "token":
                continue
            sequence[0] += 1
            event["sequence"] = sequence[0]
            async with AsyncSessionLocal() as db:
                db.add(AgentEvent(
                    run_id=run_id,
                    agent_name=event.get("agent", ""),
                    event_type=EventType(event["type"]),
                    payload=event,
                    sequence=sequence[0],
                ))
                await db.commit()

    async def _set_status(status: RunStatus, verdict: RunVerdict | None = None):
        async with AsyncSessionLocal() as db:
            run = await db.get(Run, run_id)
            run.status = status
            if verdict:
                run.verdict = verdict
            if status == RunStatus.running:
                run.started_at = datetime.now(timezone.utc)
            elif status in (RunStatus.completed, RunStatus.aborted, RunStatus.failed):
                run.completed_at = datetime.now(timezone.utc)
            await db.commit()

    await _set_status(RunStatus.running)
    emitter = _SyncEmitter(sync_q)
    drain_task = asyncio.create_task(_drain())
    process_task = asyncio.create_task(_process())

    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph
        from tradingagents.config import TradingAgentsConfig

        provider = config.get("llm_provider", "openai")
        model = config.get("llm_model", "")
        depth = config.get("depth", "standard")
        analysts = config.get("analysts") or ["market", "social", "news", "fundamentals", "technical"]
        depth_params = _DEPTH_PARAMS.get(depth, _DEPTH_PARAMS["standard"])
        ta_provider = _PROVIDER_MAP.get(provider, provider)

        stored_key = await _get_stored_key(provider)

        ta_config = TradingAgentsConfig(
            llm_provider=ta_provider,
            deep_think_llm=model,
            quick_think_llm=model,
            **depth_params,
        )

        # Patch env vars needed by TradingAgents: API keys for cloud providers,
        # server URLs for local inference.
        env_patch: dict[str, str] = {}
        if provider in _CLOUD_KEY_ENV and stored_key:
            env_patch[_CLOUD_KEY_ENV[provider]] = stored_key
        elif provider == "ollama" and stored_key:
            env_patch["OLLAMA_HOST"] = stored_key.rstrip("/")
        elif provider == "vllm" and stored_key:
            vllm_url = stored_key.rstrip("/")
            if not vllm_url.endswith("/v1"):
                vllm_url += "/v1"
            env_patch["OPENAI_BASE_URL"] = vllm_url
            env_patch["OPENAI_API_KEY"] = "vllm"

        needs_lock = bool(env_patch)
        prev_env: dict[str, str | None] = {k: os.environ.get(k) for k in env_patch}

        async with (_env_fallback_lock if needs_lock else asyncio.Lock()):
            for k, v in env_patch.items():
                os.environ[k] = v
            try:
                graph = TradingAgentsGraph(
                    config=ta_config,
                    selected_analysts=analysts,
                    callbacks=[emitter],
                )
                from app.config import settings as _settings
                final_state, signal = await asyncio.wait_for(
                    asyncio.to_thread(
                        graph.propagate,
                        config["ticker"],
                        config["analysis_date"],
                    ),
                    timeout=_settings.run_timeout_seconds,
                )
            finally:
                for k in env_patch:
                    prev = prev_env[k]
                    if prev is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = prev

        await async_q.put(None)  # sentinel
        await process_task

        verdict = _parse_verdict(signal)
        raw = final_state.model_dump() if hasattr(final_state, "model_dump") else {}
        trader_decision = str(getattr(final_state, "final_trade_decision", ""))
        suggested_entry, suggested_stop, suggested_target = _extract_prices(trader_decision)
        async with AsyncSessionLocal() as db:
            db.add(Report(
                run_id=run_id,
                trader_decision=trader_decision,
                verdict=verdict,
                suggested_entry=suggested_entry,
                suggested_stop=suggested_stop,
                suggested_target=suggested_target,
                risk_assessment=_extract_risk_assessment(final_state),
                raw_report=raw,
            ))
            await db.commit()

        await _set_status(RunStatus.completed, verdict)
        await ws_manager.broadcast(run_id, {"type": "run_completed", "run_id": run_id})

    except asyncio.TimeoutError:
        import logging
        from app.config import settings as _cfg
        logging.getLogger(__name__).error("Run %s timed out after %ss", run_id, _cfg.run_timeout_seconds)
        drain_task.cancel()
        process_task.cancel()
        await _set_status(RunStatus.failed)
        await ws_manager.broadcast(run_id, {"type": "error", "message": f"Run timed out after {_cfg.run_timeout_seconds}s"})

    except asyncio.CancelledError:
        drain_task.cancel()
        process_task.cancel()
        await _set_status(RunStatus.aborted)
        await ws_manager.broadcast(run_id, {"type": "run_aborted", "run_id": run_id})

    except Exception as exc:
        import traceback, logging
        logging.getLogger(__name__).error("Run %s failed: %s", run_id, traceback.format_exc())
        drain_task.cancel()
        process_task.cancel()
        await _set_status(RunStatus.failed)
        await ws_manager.broadcast(run_id, {"type": "error", "message": str(exc)})

    finally:
        drain_task.cancel()


def _extract_risk_assessment(state) -> str:
    rds = getattr(state, "risk_debate_state", None)
    if not rds:
        return ""
    parts = []
    if getattr(rds, "judge_decision", ""):
        parts.append(rds.judge_decision)
    if getattr(rds, "history", ""):
        parts.append(rds.history)
    return "\n\n".join(parts)


def _extract_prices(text: str) -> tuple[str | None, str | None, str | None]:
    """Regex-parse entry, stop-loss, and price target from free-form LLM text."""
    def _find(patterns: list[str]) -> str | None:
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                return m.group(1)
        return None

    entry = _find([
        r"entry\s+price\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
        r"entry\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
        r"buy\s+at\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
    ])
    stop = _find([
        r"stop[\s-]*loss\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
        r"stop\s+at\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
        r"stop\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
    ])
    target = _find([
        r"price\s+target\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
        r"take[\s-]*profit\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
        r"profit\s+target\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
        r"target\s*[:=]\s*\$?([\d,]+(?:\.\d+)?)",
    ])
    return entry, stop, target


def _parse_verdict(signal: str) -> "RunVerdict":
    from app.models.run import RunVerdict
    _NEGATION = r"(?:do\s+not|don'?t|not\s+a?)\s+"
    buy_match = re.search(r'\bbuy\b', signal, re.IGNORECASE)
    buy_negated = re.search(_NEGATION + r'buy\b', signal, re.IGNORECASE)
    sell_match = re.search(r'\bsell\b', signal, re.IGNORECASE)
    sell_negated = re.search(_NEGATION + r'sell\b', signal, re.IGNORECASE)
    if buy_match and not buy_negated:
        return RunVerdict.buy
    if sell_match and not sell_negated:
        return RunVerdict.sell
    return RunVerdict.hold
