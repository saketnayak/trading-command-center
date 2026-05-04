from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import auth, runs, api_keys, users, llm_providers

app = FastAPI(title="AgentFloor API")

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

@app.get("/health")
async def health():
    return {"status": "ok"}
