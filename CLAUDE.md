# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AgentFloor is a web UI wrapping the [TradingAgents](https://github.com/TauricResearch/TradingAgents) Python multi-agent LLM framework. It is **research-only** — no order execution. The stack is FastAPI + async SQLAlchemy 2 + PostgreSQL (backend) and Next.js 14 App Router + NextAuth v4 + TanStack Query v5 (frontend).

---

## Commands

### Backend

```bash
cd backend

# Install (use python -m to avoid system Python conflicts on macOS)
pip install uv && uv pip install --system -e ".[dev]"

# Run dev server (must use python -m, not bare uvicorn — system uvicorn may be Python 3.14)
python -m uvicorn main:app --reload

# Run all tests (requires running Postgres; see docker-compose.yml for the db service)
python -m pytest

# Run a single test file / test
python -m pytest tests/test_auth.py
python -m pytest tests/test_auth.py::test_register_first_user_is_admin

# Database migrations
DATABASE_URL=postgresql://agentfloor:agentfloor@localhost:5433/agentfloor alembic upgrade head
alembic revision --autogenerate -m "description"
```

### Frontend

```bash
cd frontend

npm install
npm run dev      # http://localhost:3000
npm run build    # production build (outputs standalone via next.config.mjs output: "standalone")
npm run lint
npx tsc --noEmit # type-check without emitting
```

### Full stack (Docker)

```bash
# Copy and fill in secrets first
cp .env.example .env

docker compose up --build        # starts db, backend, frontend, nginx
docker compose up db             # just postgres (for local backend dev)
```

Local Postgres from `docker compose up db` is mapped to **port 5433** (not 5432) to avoid conflicts.

---

## Architecture

### Backend (`backend/`)

`main.py` mounts four routers with a prefix: `/auth`, `/runs` (no prefix), `/api-keys`, `/users`. CORS is restricted to `settings.frontend_url`.

**Auth flow:** `POST /auth/register` — first user gets `admin` role automatically. Subsequent registrations require a valid invite token. `POST /auth/login` returns a JWT. All other routes use `get_current_user` (dependency in `app/dependencies.py`) which validates the Bearer token and loads the `User` row.

**Run lifecycle:**
1. `POST /runs` creates a `Run` row and immediately calls `start_run()` from `job_manager.py`.
2. `job_manager.py` wraps `execute_run()` in an `asyncio.Task` and stores it by `run_id`.
3. `trading_agent_runner.py` runs `TradingAgentsGraph.propagate()` in a thread (`asyncio.to_thread`) because TradingAgents is synchronous. A `_SyncEmitter(BaseCallbackHandler)` puts events into a `SyncQueue`; a drain coroutine transfers them to an `asyncio.Queue`; a process coroutine persists `AgentEvent` rows and broadcasts over WebSocket.
4. `DELETE /runs/{run_id}` calls `abort_run()` which cancels the asyncio task, triggering `CancelledError` in the runner, which sets status to `aborted`.
5. `GET /runs/{run_id}/report` returns the `Report` row created at completion.

**WebSocket:** `ws_manager` (singleton in `websocket_manager.py`) maintains `dict[run_id, list[WebSocket]]`. The WS endpoint at `/ws/runs/{run_id}` loops on `receive_text()` to keep the connection alive; clients send `"ping"` every 30 s.

**Encryption:** API keys are stored encrypted. `services/encryption.py` derives a `Fernet` key from the 64-hex-char `ENCRYPTION_KEY` setting.

**Config:** All settings are in `app/config.py` via pydantic-settings. The relevant env var names are: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FRONTEND_URL`.

**Tests:** All tests share one event loop (`asyncio_default_test_loop_scope = "session"` in pyproject.toml). The `clean_db` session-scoped autouse fixture in `conftest.py` TRUNCATEs all tables before each test session, making runs idempotent.

### Frontend (`frontend/`)

**Auth:** NextAuth v4 with `CredentialsProvider` (calls `POST /auth/login` on the backend) and optional `GoogleProvider`. Session strategy is JWT. `middleware.ts` protects all routes except `/login`, `/register`, `/api/auth/**`.

**API client:** `lib/api.ts` exports typed async functions. All calls go through `fetchWithAuth`, which reads the session token from NextAuth and sets `Authorization: Bearer <token>`. `NEXT_PUBLIC_API_URL` points to the backend (defaults to `http://localhost:8000`).

**WebSocket:** `lib/websocket.ts` exports `useAgentStream(runId, onEvent)`. It connects to `ws://<API_HOST>/ws/runs/{runId}`, sends a ping every 30 s, and auto-reconnects after 2 s on non-1000 close codes.

**Page routing:**
- `/` → redirect to `/runs`
- `/runs` — run history with ticker/status filters
- `/runs/new` — launch a new run (analyst selection, LLM config)
- `/runs/[id]/live` — live monitor with WebSocket event feed + pipeline status
- `/runs/[id]` — results viewer (verdict, per-analyst tabs, bull/bear debate, download menu)
- `/settings` — API key management + team admin (admin-only sections)

**Export (`lib/export/`):** Three client-side utilities used by `DownloadMenu`:
- `buildMarkdown(run, report)` — assembles a `.md` string covering all report fields (verdict, analyst reports, debate, plan, final decision). Missing fields are silently omitted.
- `parseMdForPdf(text)` — line-by-line Markdown → `MdSegment[]` (h1/h2/h3/bullet/paragraph/blank). Used by `ReportPdf.tsx` to render text inside `@react-pdf/renderer` (which does not accept HTML).
- `ReportDocument` — `@react-pdf/renderer` Document component. Cover page + one section per report field, each starting a new page via `<View break>`. Shared fixed header (AgentFloor | TICKER — date) on every page. Dynamically imported in `DownloadMenu` so the ~400 KB bundle is not loaded until first PDF click.

**Data fetching:** TanStack Query v5 (`useQuery` / `useMutation`). `QueryClient` and `SessionProvider` are set up in `app/providers.tsx`, which wraps `app/layout.tsx`.

**Components (`components/runs/`):** `TraderDecision`, `AnalystReports`, `BullBearDebate`, `DownloadMenu` (JSON/Markdown/PDF dropdown — replaces the former inline JSON button), `PipelinePanel`, `AgentFeed`, `RunTable`, `RunFilters`, `StatsBar`.

### Deployment

`docker-compose.yml` runs four services: `db` (postgres:16), `backend`, `frontend`, `nginx`. The backend waits for the `db` healthcheck before starting. Nginx reverse-proxies `/api/` → backend, `/ws/` → backend (with WebSocket upgrade headers), and everything else → frontend. TLS is not included — add certbot separately.
