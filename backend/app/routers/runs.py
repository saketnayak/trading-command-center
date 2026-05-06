import asyncio
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.run import Run, RunStatus, RunVerdict
from app.models.report import Report
from app.models.agent_event import AgentEvent
from app.schemas.run import RunCreateRequest, RunResponse
from app.services.websocket_manager import ws_manager
from app.services.job_manager import start_run, abort_run
from app.dependencies import get_current_user
from app.models.user import User


class ReportResponse(BaseModel):
    id: UUID
    run_id: UUID
    trader_decision: str
    verdict: str
    suggested_entry: str | None
    suggested_stop: str | None
    suggested_target: str | None
    risk_assessment: str
    raw_report: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RunWithReport(BaseModel):
    run: RunResponse
    report: ReportResponse | None

    model_config = ConfigDict(from_attributes=True)


class RunOutcomeResponse(BaseModel):
    id: UUID
    run_id: UUID
    ticker: str
    verdict: str
    analysis_date: str
    price_at_analysis: float | None
    price_7d: float | None
    price_14d: float | None
    price_30d: float | None
    price_90d: float | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


router = APIRouter()


def _run_to_response(run: Run) -> RunResponse:
    base = RunResponse.model_validate(run)
    if run.report:
        return base.model_copy(update={
            "suggested_entry": run.report.suggested_entry,
            "suggested_stop": run.report.suggested_stop,
            "suggested_target": run.report.suggested_target,
        })
    return base


@router.get("/runs", response_model=list[RunResponse])
async def list_runs(
    ticker: str | None = Query(None),
    verdict: str | None = Query(None),
    user_id: UUID | None = Query(None),
    archived: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    q = select(Run).options(selectinload(Run.report)).order_by(Run.created_at.desc())
    q = q.where(Run.archived == archived)
    if ticker:
        q = q.where(Run.ticker.ilike(ticker))
    if verdict:
        q = q.where(Run.verdict == verdict)
    if user_id:
        q = q.where(Run.created_by == user_id)
    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    runs = result.scalars().all()
    return [_run_to_response(run) for run in runs]


@router.post("/runs", response_model=RunResponse, status_code=status.HTTP_201_CREATED)
async def create_run(
    req: RunCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = Run(
        created_by=user.id,
        ticker=req.ticker.upper(),
        analysis_date=req.analysis_date,
        llm_provider=req.llm_provider,
        llm_model=req.llm_model,
        depth=req.depth,
        analysts=req.analysts,
        label=req.label,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    await start_run(str(run.id), {
        "ticker": run.ticker,
        "analysis_date": str(run.analysis_date),
        "llm_provider": run.llm_provider,
        "llm_model": run.llm_model,
        "depth": run.depth,
        "analysts": run.analysts,
    })
    return run


@router.get("/runs/stats")
async def get_run_stats(db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    result = await db.execute(
        select(
            func.count().label("total"),
            func.sum(case((Run.verdict == RunVerdict.buy, 1), else_=0)).label("buy_count"),
            func.sum(case((Run.verdict == RunVerdict.sell, 1), else_=0)).label("sell_count"),
            func.sum(case((Run.verdict == RunVerdict.hold, 1), else_=0)).label("hold_count"),
            func.sum(case((Run.status == RunStatus.completed, 1), else_=0)).label("completed"),
            func.sum(case((Run.status == RunStatus.failed, 1), else_=0)).label("failed"),
        ).select_from(Run).where(Run.archived == False)
    )
    row = result.one()
    dur_result = await db.execute(
        select(
            func.avg(func.extract("epoch", Run.completed_at) - func.extract("epoch", Run.started_at))
        ).select_from(Run).where(
            Run.archived == False,
            Run.status == RunStatus.completed,
            Run.started_at.isnot(None),
            Run.completed_at.isnot(None),
        )
    )
    avg_dur = dur_result.scalar() or 0
    return {
        "total": row.total or 0,
        "verdicts": {"buy": row.buy_count or 0, "sell": row.sell_count or 0, "hold": row.hold_count or 0},
        "completed": row.completed or 0,
        "failed": row.failed or 0,
        "avg_duration_secs": round(avg_dur),
    }


@router.get("/runs/performance")
async def get_performance_stats(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    from app.models.outcome import RunOutcome
    result = await db.execute(select(RunOutcome))
    outcomes = result.scalars().all()
    total = len(outcomes)
    if total == 0:
        return {"total": 0, "accuracy_7d": None, "accuracy_14d": None, "accuracy_30d": None, "accuracy_90d": None, "outcomes": []}

    def accuracy(days_attr: str) -> float | None:
        scored = [o for o in outcomes if o.price_at_analysis and getattr(o, days_attr)]
        if not scored:
            return None
        correct = sum(
            1 for o in scored
            if (o.verdict == "buy" and getattr(o, days_attr) > o.price_at_analysis)
            or (o.verdict == "sell" and getattr(o, days_attr) < o.price_at_analysis)
        )
        return round(correct / len(scored) * 100, 1)

    return {
        "total": total,
        "accuracy_7d": accuracy("price_7d"),
        "accuracy_14d": accuracy("price_14d"),
        "accuracy_30d": accuracy("price_30d"),
        "accuracy_90d": accuracy("price_90d"),
        "outcomes": [
            {
                "run_id": str(o.run_id),
                "ticker": o.ticker,
                "verdict": o.verdict,
                "analysis_date": o.analysis_date,
                "price_at_analysis": o.price_at_analysis,
                "price_7d": o.price_7d,
                "price_14d": o.price_14d,
                "price_30d": o.price_30d,
                "price_90d": o.price_90d,
            }
            for o in outcomes
        ],
    }


@router.get("/runs/compare")
async def compare_runs(
    a: UUID = Query(...),
    b: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    async def load(run_id: UUID) -> RunWithReport:
        result = await db.execute(
            select(Run).where(Run.id == run_id).options(selectinload(Run.report))
        )
        run = result.scalar_one_or_none()
        if not run:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Run {run_id} not found")
        report_result = await db.execute(select(Report).where(Report.run_id == run_id))
        report = report_result.scalar_one_or_none()
        return RunWithReport(run=_run_to_response(run), report=report)

    run_a, run_b = await asyncio.gather(load(a), load(b))
    return {"a": run_a, "b": run_b}


@router.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(run_id: UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Run).where(Run.id == run_id).options(selectinload(Run.report))
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    return _run_to_response(run)


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def abort_run_endpoint(run_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    run = await db.get(Run, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    if str(run.created_by) != str(user.id) and user.role.value != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized")
    abort_run(str(run_id))


@router.post("/runs/{run_id}/archive", response_model=RunResponse)
async def archive_run(run_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    run = await db.get(Run, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    if str(run.created_by) != str(user.id) and user.role.value != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized")
    run.archived = not run.archived
    await db.commit()
    await db.refresh(run)
    return run


@router.delete("/runs/{run_id}/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_run(run_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.agent_event import AgentEvent
    from app.models.report import Report
    from sqlalchemy import delete as sql_delete

    run = await db.get(Run, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    if str(run.created_by) != str(user.id) and user.role.value != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized")
    if run.status.value == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot delete a running run — abort it first")
    await db.execute(sql_delete(AgentEvent).where(AgentEvent.run_id == run_id))
    await db.execute(sql_delete(Report).where(Report.run_id == run_id))
    await db.delete(run)
    await db.commit()


@router.get("/runs/{run_id}/report", response_model=ReportResponse)
async def get_report(run_id: UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    result = await db.execute(select(Report).where(Report.run_id == run_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    return report


@router.get("/runs/{run_id}/outcome", response_model=RunOutcomeResponse)
async def get_run_outcome(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    from app.services.outcome_service import get_or_create_outcome
    try:
        outcome = await get_or_create_outcome(str(run_id), db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return outcome


@router.get("/runs/{run_id}/events")
async def get_run_events(run_id: UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    result = await db.execute(
        select(AgentEvent).where(AgentEvent.run_id == run_id).order_by(AgentEvent.sequence)
    )
    events = result.scalars().all()
    return [e.payload for e in events]


@router.websocket("/ws/runs/{run_id}")
async def run_websocket(run_id: str, ws: WebSocket):
    await ws_manager.connect(run_id, ws)
    try:
        while True:
            await ws.receive_text()  # keep alive — client sends pings
    except WebSocketDisconnect:
        ws_manager.disconnect(run_id, ws)
