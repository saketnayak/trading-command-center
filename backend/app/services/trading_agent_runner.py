import asyncio
import os
from queue import Queue as SyncQueue
from datetime import datetime, timezone
from langchain_core.callbacks import BaseCallbackHandler

# Serializes the env-var fallback path so concurrent runs don't race on os.environ
_env_fallback_lock = asyncio.Lock()

AGENT_NODES = {
    "fundamentals_analyst", "sentiment_analyst", "news_analyst",
    "technical_analyst", "bull_researcher", "bear_researcher",
    "trader", "risk_manager",
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


async def _build_llm(provider: str, model: str):
    """Return a ChatOpenAI configured for local inference, or None for cloud providers."""
    if provider not in ("ollama", "vllm"):
        return None

    from app.database import AsyncSessionLocal
    from app.models.api_key import ApiKey
    from app.services.encryption import decrypt_key
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(ApiKey).where(ApiKey.provider == provider))).scalar_one_or_none()

    if not row:
        return None

    from langchain_openai import ChatOpenAI
    base_url = decrypt_key(row.encrypted_key).rstrip("/")
    if not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"

    return ChatOpenAI(
        base_url=base_url,
        model=model,
        api_key="ollama",
    )


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
            await ws_manager.broadcast(run_id, event)

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
        from langchain_core.runnables import RunnableConfig

        llm = await _build_llm(config.get("llm_provider", ""), config.get("llm_model", ""))

        _prev_base = os.environ.get("OPENAI_API_BASE")
        _prev_key = os.environ.get("OPENAI_API_KEY")
        _patched_env = False

        try:
            graph = TradingAgentsGraph(llm=llm) if llm else TradingAgentsGraph()
        except TypeError as exc:
            if "llm" not in str(exc) and "unexpected keyword" not in str(exc):
                raise
            # TradingAgentsGraph does not accept an llm arg — fall back to env-var patching.
            # Acquires _env_fallback_lock to prevent concurrent runs from racing on os.environ.
            if llm is not None:
                _patched_env = True
            graph = TradingAgentsGraph()

        lc_config = RunnableConfig(callbacks=[emitter])
        async with (_env_fallback_lock if _patched_env else asyncio.Lock()):
            if _patched_env:
                os.environ["OPENAI_API_BASE"] = llm.openai_api_base or ""
                os.environ["OPENAI_API_KEY"] = "ollama"
            try:
                result = await asyncio.to_thread(
                    graph.propagate,
                    config["ticker"],
                    config["analysis_date"],
                    config=lc_config,
                )
            finally:
                if _patched_env:
                    if _prev_base is None:
                        os.environ.pop("OPENAI_API_BASE", None)
                    else:
                        os.environ["OPENAI_API_BASE"] = _prev_base
                    if _prev_key is None:
                        os.environ.pop("OPENAI_API_KEY", None)
                    else:
                        os.environ["OPENAI_API_KEY"] = _prev_key
        await async_q.put(None)  # sentinel
        await process_task

        verdict = _parse_verdict(result)
        async with AsyncSessionLocal() as db:
            db.add(Report(
                run_id=run_id,
                trader_decision=str(result.get("trader_decision", "")),
                verdict=verdict,
                suggested_entry=result.get("suggested_entry"),
                suggested_stop=result.get("suggested_stop"),
                suggested_target=result.get("suggested_target"),
                risk_assessment=str(result.get("risk_assessment", "")),
                raw_report=result if isinstance(result, dict) else {},
            ))
            await db.commit()

        await _set_status(RunStatus.completed, verdict)
        await ws_manager.broadcast(run_id, {"type": "run_completed", "run_id": run_id})

    except asyncio.CancelledError:
        drain_task.cancel()
        process_task.cancel()
        await _set_status(RunStatus.aborted)
        await ws_manager.broadcast(run_id, {"type": "run_aborted", "run_id": run_id})

    except Exception as exc:
        drain_task.cancel()
        process_task.cancel()
        await _set_status(RunStatus.failed)
        await ws_manager.broadcast(run_id, {"type": "error", "message": str(exc)})

    finally:
        drain_task.cancel()


def _parse_verdict(result: dict) -> "RunVerdict":
    from app.models.run import RunVerdict
    raw = str(result.get("decision", result.get("action", "hold"))).lower()
    if "buy" in raw:
        return RunVerdict.buy
    if "sell" in raw:
        return RunVerdict.sell
    return RunVerdict.hold
