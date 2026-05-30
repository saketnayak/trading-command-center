import asyncio
import os
from queue import Queue as SyncQueue
from datetime import datetime, timezone
from langchain_core.callbacks import BaseCallbackHandler

# Serializes env-var patching so concurrent local-inference runs don't race on os.environ.
_env_fallback_lock = asyncio.Lock()

# LangGraph node names emitted by TradingAgents v0.7 (callback `name` is lower_snake).
AGENT_NODES = {
    "market_analyst",
    "social_analyst",
    "news_analyst",
    "fundamentals_analyst",
    "situation_summariser",
    "bull_researcher",
    "bear_researcher",
    "research_manager",
    "trader",
    "aggressive_analyst",
    "conservative_analyst",
    "neutral_analyst",
    "risk_judge",
}

# Maps AgentFloor provider names to TradingAgentsConfig llm_provider literals.
_PROVIDER_MAP: dict[str, str] = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google_genai",
    "ollama": "ollama",
    "vllm": "openai",   # vLLM is OpenAI-compatible
    "groq": "openai",   # Groq is OpenAI-compatible
    "ionos": "openai",  # IONOS is OpenAI-compatible
}

# max_recur_limit floor is 30 in tradingagents>=0.7 (Situation Summariser node).
_DEPTH_PARAMS: dict[str, dict] = {
    "quick": {"max_debate_rounds": 1, "max_risk_discuss_rounds": 1, "max_recur_limit": 75},
    "standard": {"max_debate_rounds": 2, "max_risk_discuss_rounds": 2, "max_recur_limit": 150},
    "deep": {"max_debate_rounds": 3, "max_risk_discuss_rounds": 3, "max_recur_limit": 200},
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
    "groq": "GROQ_API_KEY",
    "ionos": "IONOS_API_KEY",
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
    from app.utils.asset_type import is_crypto as _is_crypto
    from app.utils.tradingagents_analysts import normalize_analysts

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
        ticker = config.get("ticker", "")
        analysts = normalize_analysts(
            config.get("analysts"),
            exclude_fundamentals=_is_crypto(ticker),
        )
        depth_params = _DEPTH_PARAMS.get(depth, _DEPTH_PARAMS["standard"])
        ta_provider = _PROVIDER_MAP.get(provider, provider)

        stored_key = await _get_stored_key(provider)

        ta_config = TradingAgentsConfig(
            llm_provider=ta_provider,
            deep_think_llm=model,
            quick_think_llm=model,
            response_language="en-US",
            **depth_params,
        )

        # Patch env vars needed by TradingAgents: API keys for cloud providers,
        # server URLs for local inference.
        env_patch: dict[str, str] = {}
        if provider == "ionos" and stored_key:
            env_patch["OPENAI_BASE_URL"] = "https://openai.inference.de-txl.ionos.com/v1"
            env_patch["OPENAI_API_KEY"] = stored_key
        elif provider == "groq" and stored_key:
            env_patch["OPENAI_BASE_URL"] = "https://api.groq.com/openai/v1"
            env_patch["OPENAI_API_KEY"] = stored_key
        elif provider in _CLOUD_KEY_ENV and stored_key:
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
                final_state, recommendation = await asyncio.wait_for(
                    asyncio.to_thread(
                        graph.propagate,
                        ticker,
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

        verdict = _parse_verdict(recommendation)
        raw = final_state.model_dump() if hasattr(final_state, "model_dump") else {}
        trader_decision = _extract_trader_decision(final_state, recommendation)

        suggested_entry = _normalize_price(getattr(recommendation, "entry_reference_price", None))
        suggested_stop = _normalize_price(getattr(recommendation, "stop_loss", None))
        suggested_target = _normalize_price(getattr(recommendation, "target_price", None))
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

        # Fire-and-forget completion email; failure never affects run status
        try:
            from app.models.user import User
            from app.services.email import send_run_complete_email
            from app.config import settings as _cfg
            async with AsyncSessionLocal() as db:
                run_row = await db.get(Run, run_id)
                user_row = await db.get(User, run_row.created_by)
                if user_row and run_row.verdict:
                    await send_run_complete_email(
                        to=user_row.email,
                        ticker=run_row.ticker,
                        verdict=run_row.verdict.value,
                        run_id=run_id,
                        frontend_url=_cfg.frontend_url,
                    )
        except Exception:
            pass

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


def _normalize_price(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"none", "null", "n/a", "na"}:
        return None
    return text


def _extract_trader_decision(state, recommendation) -> str:
    rationale = getattr(recommendation, "rationale", None)
    if rationale:
        return str(rationale).strip()

    final_recommendation = getattr(state, "final_trade_recommendation", None)
    if final_recommendation is not None:
        final_rationale = getattr(final_recommendation, "rationale", None)
        if final_rationale:
            return str(final_rationale).strip()

    final_decision = getattr(state, "final_trade_decision", "")
    return str(final_decision).strip()


def _parse_verdict(recommendation) -> "RunVerdict":
    from app.models.run import RunVerdict

    signal = str(getattr(recommendation, "signal", "")).strip().lower()
    if signal in ("buy", "b"):
        return RunVerdict.buy
    if signal in ("sell", "s"):
        return RunVerdict.sell
    return RunVerdict.hold
