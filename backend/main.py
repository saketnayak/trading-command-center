from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update
from app.config import settings
from app.database import AsyncSessionLocal
from app.models.run import Run, RunStatus
from app.routers import auth, runs, api_keys, users, llm_providers, watchlist, portfolio, ticker, tickers, admin, market, investor_profile, regime, wave, kalman, settings as settings_router
from app.services.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(Run)
            .where(Run.status == RunStatus.running)
            .values(status=RunStatus.failed, completed_at=datetime.now(timezone.utc))
        )
        await db.commit()
    await start_scheduler()
    yield
    await stop_scheduler()


app = FastAPI(title="AgentFloor API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(runs.router, tags=["runs"])
app.include_router(api_keys.router, prefix="/api-keys", tags=["api-keys"])
app.include_router(users.router, prefix="/users", tags=["users"])
app.include_router(llm_providers.router, prefix="/llm-providers", tags=["llm-providers"])
app.include_router(watchlist.router, tags=["watchlist"])
app.include_router(portfolio.router, tags=["portfolio"])
app.include_router(ticker.router, tags=["ticker"])
app.include_router(tickers.router, tags=["tickers"])
app.include_router(market.router, tags=["market"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])
app.include_router(investor_profile.router, prefix="/investor-profile", tags=["investor-profile"])
app.include_router(regime.router, tags=["regime"])
app.include_router(wave.router, tags=["wave"])
app.include_router(kalman.router, tags=["kalman"])
app.include_router(settings_router.router, tags=["settings"])


@app.get("/health")
async def health():
    return {"status": "ok"}
