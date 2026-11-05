"""Start a live TradingAgents run on a user's behalf (MCP `start_analysis`, alert re-runs).

Research only: a run produces a report and a BUY/HOLD/SELL verdict, never an order.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.run import Run
from app.models.user import User


class LaunchError(ValueError):
    pass


async def launch_run(db: AsyncSession, user: User, ticker: str, *, label: str, depth: str = "quick",
                     llm_provider: str | None = None, llm_model: str | None = None) -> Run:
    """Create a Run with the user's default LLM (or the one given), commit it and start it."""
    from app.schemas.run import RunCreateRequest
    from app.services import job_manager, llm_selection
    from app.utils.asset_type import is_crypto
    from app.utils.tradingagents_analysts import normalize_analysts

    if not llm_provider:
        picked = await llm_selection.pick_llm_for_user(db, user)
        if picked is None:
            raise LaunchError("No LLM provider key is configured; add one in Settings.")
        llm_provider, llm_model = picked
    try:
        req = RunCreateRequest(ticker=ticker, analysis_date=date.today(), llm_provider=llm_provider,
                               llm_model=llm_model or "", depth=depth)
    except ValueError as exc:
        raise LaunchError(str(exc)) from exc
    run = Run(created_by=user.id, ticker=ticker, analysis_date=req.analysis_date, llm_provider=req.llm_provider,
              llm_model=req.llm_model, depth=req.depth,
              analysts=normalize_analysts(req.analysts, exclude_fundamentals=is_crypto(ticker)),
              response_language=req.response_language, label=label)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    await job_manager.start_run(str(run.id), {
        "ticker": run.ticker, "analysis_date": str(run.analysis_date), "llm_provider": run.llm_provider,
        "llm_model": run.llm_model, "depth": run.depth, "analysts": run.analysts,
        "response_language": run.response_language,
    })
    return run
