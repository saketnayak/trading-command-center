import asyncio

from app.services.llm_provider_registry import LOCAL_PROVIDER_IDS

_running_tasks: dict[str, asyncio.Task] = {}


async def start_run(run_id: str, config: dict) -> None:
    from app.services.trading_agent_runner import execute_run
    task = asyncio.create_task(execute_run(run_id, config))
    _running_tasks[run_id] = task
    task.add_done_callback(lambda _: _running_tasks.pop(run_id, None))


async def _serial_coordinator(items: list[tuple[str, dict]]) -> None:
    """Execute a list of runs one at a time, stopping the batch on cancellation."""
    from app.services.trading_agent_runner import execute_run
    try:
        for run_id, config in items:
            try:
                await execute_run(run_id, config)
            except Exception:
                pass  # execute_run sets its own failed/aborted status
            _running_tasks.pop(run_id, None)
    finally:
        # On cancellation (or normal finish) clean up any not-yet-started entries.
        for run_id, _ in items:
            _running_tasks.pop(run_id, None)


async def start_runs_batch(items: list[tuple[str, dict]]) -> None:
    """Start a batch of runs.

    Local providers (Ollama, vLLM, LiteLLM) run serially so they don't exhaust
    limited local resources.  Cloud providers run in parallel as before.
    """
    if not items:
        return
    provider = items[0][1].get("llm_provider", "")
    if provider in LOCAL_PROVIDER_IDS:
        coordinator = asyncio.create_task(_serial_coordinator(items))
        for run_id, _ in items:
            _running_tasks[run_id] = coordinator
    else:
        for run_id, config in items:
            await start_run(run_id, config)


def abort_run(run_id: str) -> bool:
    task = _running_tasks.get(run_id)
    if task and not task.done():
        task.cancel()
        return True
    return False


def is_running(run_id: str) -> bool:
    return run_id in _running_tasks
