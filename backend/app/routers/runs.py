from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.run import Run
from app.models.agent_event import AgentEvent
from app.schemas.run import RunCreateRequest, RunResponse
from app.services.websocket_manager import ws_manager
from app.services.job_manager import start_run, abort_run
from app.dependencies import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("/runs", response_model=list[RunResponse])
async def list_runs(
    ticker: str | None = Query(None),
    verdict: str | None = Query(None),
    user_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    q = select(Run).order_by(Run.created_at.desc())
    if ticker:
        q = q.where(Run.ticker.ilike(ticker))
    if verdict:
        q = q.where(Run.verdict == verdict)
    if user_id:
        q = q.where(Run.created_by == user_id)
    result = await db.execute(q)
    return result.scalars().all()


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


@router.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(run_id: UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    run = await db.get(Run, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    return run


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def abort_run_endpoint(run_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    run = await db.get(Run, run_id)
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    if str(run.created_by) != str(user.id) and user.role.value != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized")
    abort_run(str(run_id))


@router.get("/runs/{run_id}/events")
async def get_run_events(run_id: UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    result = await db.execute(
        select(AgentEvent).where(AgentEvent.run_id == run_id).order_by(AgentEvent.sequence)
    )
    events = result.scalars().all()
    return [{"type": e.event_type, "agent": e.agent_name, "payload": e.payload, "sequence": e.sequence} for e in events]


@router.websocket("/ws/runs/{run_id}")
async def run_websocket(run_id: str, ws: WebSocket):
    await ws_manager.connect(run_id, ws)
    try:
        while True:
            await ws.receive_text()  # keep alive — client sends pings
    except WebSocketDisconnect:
        ws_manager.disconnect(run_id, ws)
