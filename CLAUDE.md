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

`main.py` mounts seven routers and manages the APScheduler lifespan:

| Prefix | Router | Purpose |
|---|---|---|
| `/auth` | `auth.py` | Register, login, Google OAuth, invite tokens |
| (none) | `runs.py` | Run CRUD, report, compare, performance, outcome |
| `/api-keys` | `api_keys.py` | Encrypted provider key storage |
| `/users` | `users.py` | Profile, team admin |
| `/llm-providers` | `llm_providers.py` | Static model lists + live local server queries (Ollama/vLLM) |
| (none) | `watchlist.py` | Watchlist CRUD, schedule management, manual run trigger, scheduler diagnostics (`GET /watchlist/scheduler/jobs`) |
| (none) | `portfolio.py` | Portfolio CRUD, CSV snapshot upload, holding-level add/edit/delete, live price enrichment, CSV export, AI insight generation/listing |

CORS is restricted to `settings.frontend_url`.

**Auth flow:** `POST /auth/register` — first user gets `admin` role automatically. Subsequent registrations require a valid invite token. `POST /auth/login` returns a JWT. All other routes use `get_current_user` (dependency in `app/dependencies.py`) which validates the Bearer token and loads the `User` row. `POST /auth/invite` generates a signed invite token and emails the link; when SMTP is not configured the invite URL is returned in the response body (`invite_url` field) so the admin can copy-paste it.

**Run lifecycle:**
1. `POST /runs` creates a `Run` row and immediately calls `start_run()` from `job_manager.py`.
2. `job_manager.py` wraps `execute_run()` in an `asyncio.Task` and stores it by `run_id`.
3. `trading_agent_runner.py` runs `TradingAgentsGraph.propagate()` in a thread (`asyncio.to_thread`) because TradingAgents is synchronous. A `_SyncEmitter(BaseCallbackHandler)` puts events into a `SyncQueue`; a drain coroutine transfers them to an `asyncio.Queue`; a process coroutine persists `AgentEvent` rows and broadcasts over WebSocket.
4. `DELETE /runs/{run_id}` calls `abort_run()` which cancels the asyncio task, triggering `CancelledError` in the runner, which sets status to `aborted`.
5. `GET /runs/{run_id}/report` returns the `Report` row created at completion.
6. On completion, `outcome_service.py` lazily fetches closing prices from Finnhub (`/stock/candle`) at +7d/+14d/+30d/+90d and persists a `RunOutcome` row.

**Watchlist & Scheduler:** `watchlist.py` router manages per-user watchlists (one per user, auto-created on first access). Each `WatchlistItem` stores ticker, LLM config, and an optional cron expression. `services/scheduler.py` wraps APScheduler 4.x `AsyncScheduler`. On startup it calls `start_in_background()` (required — `__aenter__` alone leaves the scheduler in `RunState.stopped`) then `_reload_jobs()` to register all enabled items. After every watchlist mutation the router calls `reload_jobs()` so changes take effect without restart. Additionally, a system-level daily job (`daily_portfolio_insights`, weekdays 09:15 UTC) calls `_fire_daily_portfolio_insights()`, which picks the first configured LLM provider key and generates a `PortfolioInsight` for every portfolio that has holdings and no insight in the last 12 hours.

**WebSocket:** `ws_manager` (singleton in `websocket_manager.py`) maintains `dict[run_id, list[WebSocket]]`. The WS endpoint at `/ws/runs/{run_id}` loops on `receive_text()` to keep the connection alive; clients send `"ping"` every 30 s.

**Encryption:** API keys are stored encrypted. `services/encryption.py` derives a `Fernet` key from the 64-hex-char `ENCRYPTION_KEY` setting.

**Config:** All settings are in `app/config.py` via pydantic-settings. Env var names: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FRONTEND_URL`. For local inference: `OLLAMA_HOST` (default `http://localhost:11434`) and `VLLM_BASE_URL` (default `http://localhost:8080`) are read via `getattr(settings, ..., default)` — add them to `config.py` if you need to override the defaults.

**Tests:** All tests share one event loop (`asyncio_default_test_loop_scope = "session"` in pyproject.toml). The `clean_db` session-scoped autouse fixture in `conftest.py` TRUNCATEs all tables before each test session: `users, runs, agent_events, reports, api_keys, run_outcomes, watchlists, watchlist_items, portfolios, portfolio_snapshots, portfolio_holdings, portfolio_insights`.

### Frontend (`frontend/`)

**Auth:** NextAuth v4 with `CredentialsProvider` (calls `POST /auth/login` on the backend) and optional `GoogleProvider`. Session strategy is JWT. `middleware.ts` protects all routes except `/login`, `/register`, `/api/auth/**`.

**API client:** `lib/api.ts` exports typed async functions. All calls go through `fetchWithAuth`, which reads the session token from NextAuth and sets `Authorization: Bearer <token>`. `NEXT_PUBLIC_API_URL` points to the backend (defaults to `http://localhost:8000`).

**WebSocket:** `lib/websocket.ts` exports `useAgentStream(runId, onEvent)`. It connects to `ws://<API_HOST>/ws/runs/{runId}`, sends a ping every 30 s, and auto-reconnects after 2 s on non-1000 close codes.

**Page routing:**
- `/` → redirect to `/runs`
- `/runs` — run history with ticker/status/verdict filters and a stats bar
- `/runs/new` — launch a new run (analyst selection, LLM config, depth)
- `/runs/[id]/live` — live monitor with WebSocket event feed + pipeline status
- `/runs/[id]` — results viewer (verdict, per-analyst tabs, bull/bear debate, outcome price grid, download menu)
- `/runs/compare` — side-by-side comparison of two runs. Entry points: (1) check up to two completed runs on the history page — a banner with "Compare 2 runs →" appears; (2) click "Compare →" on any run detail page — the compare page shows a run picker when only `?a=<id>` is in the URL. Full comparison loads at `?a=<id>&b=<id>`.
- `/runs/performance` — accuracy stats (7d/14d/30d/90d) and outcomes table across all completed runs
- `/watchlist` — ticker watchlist with visual schedule builder; per-item manual run trigger
- `/portfolio` — portfolio manager with two tabs: **Holdings** (CSV upload, live prices via Finnhub, unrealized P&L, inline row editing, CSV export) and **AI Insights** (generate / view AI-powered portfolio briefings — health score, action items, risk alerts, sector exposure). Multiple portfolios per user; each portfolio holds versioned snapshots.
- `/settings` — API key management (Finnhub for portfolio prices + outcome tracking; LLM providers) + team admin (admin-only). Invite URL is shown inline when SMTP is not configured.

**Export (`lib/export/`):** Three client-side utilities used by `DownloadMenu`:
- `buildMarkdown(run, report)` — assembles a `.md` string covering all report fields (verdict, analyst reports, debate, plan, final decision). Missing fields are silently omitted.
- `parseMdForPdf(text)` — line-by-line Markdown → `MdSegment[]` (h1/h2/h3/bullet/paragraph/blank). Used by `ReportPdf.tsx` to render text inside `@react-pdf/renderer` (which does not accept HTML).
- `ReportDocument` — `@react-pdf/renderer` Document component. Cover page + one section per report field, each starting a new page via `<View break>`. Shared fixed header (AgentFloor | TICKER — date) on every page. Dynamically imported in `DownloadMenu` so the ~400 KB bundle is not loaded until first PDF click.

**Data fetching:** TanStack Query v5 (`useQuery` / `useMutation`). `QueryClient` and `SessionProvider` are set up in `app/providers.tsx`, which wraps `app/layout.tsx`.

**Components (`components/runs/`):** `TraderDecision`, `AnalystReports`, `BullBearDebate`, `DownloadMenu` (JSON/Markdown/PDF dropdown), `ComparisonPanel` (side-by-side run columns with agreement badge), `OutcomeCard` (price grid at +7/14/30/90d, sourced from Finnhub), `PipelinePanel`, `AgentFeed`, `AgentSidebar`, `RunTable` (accepts optional `selectedIds`/`onSelectionChange` for checkbox multi-select; caps at 2 with FIFO replacement; only completed runs are selectable), `RunFilters`, `RunForm`, `StatsBar`.

**Components (`components/portfolio/`):** `PortfolioSwitcher` (dropdown with create/delete), `PortfolioHeader` (totals bar with upload/export buttons), `UploadDrawer` (drag-drop CSV zone), `HoldingsTable` (inline-editable table — click Edit to modify ticker/shares/avg cost in place, ✕ to delete a row, "+ Add row" to insert a new holding; current price/market value/P&L are read-only, sourced from Finnhub), `InsightsDashboard` (AI insights tab — sidebar history list, generate form with provider/model picker, SVG health-score ring, action item cards, risk alert cards, CSS-bar sector chart, strengths/weaknesses panels; auto-polls every 2 s while an insight is `pending`/`running`). The `price_unavailable_reason` field is `"no_finnhub_key"` when no Finnhub key is stored.

**Portfolio data model:** `Portfolio` → `PortfolioSnapshot` → `PortfolioHolding` (cascade delete). Each upload creates a new snapshot. Holding-level endpoints (`POST/PATCH/DELETE /portfolio/{id}/holdings/{holding_id}`) mutate the latest snapshot and keep `row_count` in sync. Prices are fetched concurrently via `asyncio.gather` and cached in-process for 1 hour.

**Portfolio Insights:** `Portfolio` also has a one-to-many `insights` relationship to `PortfolioInsight` (cascade delete). Each `PortfolioInsight` row has `status` (`pending`→`running`→`completed`/`failed`), `trigger` (`manual`/`scheduled`), LLM provider/model, and JSONB output fields: `health_score` (1–10 int), `overall_stance` (`bullish`/`bearish`/`neutral`/`mixed`), `summary`, `action_items`, `risk_alerts`, `sector_analysis`, `strengths`, `weaknesses`, and `holdings_snapshot` (prices/P&L captured at generation time). The `portfolio_insight_runner.py` service: fetches live prices (reuses Finnhub cache), fetches sector data from Finnhub `/stock/profile2` (24 h in-process cache), collects last run verdicts from the DB, builds a structured JSON prompt, calls the provider API directly via httpx (OpenAI → `api.openai.com`; Anthropic → `api.anthropic.com`; Google → `generativelanguage.googleapis.com`; Ollama/vLLM → local base URL), and parses/persists the result. Concurrency guard: only one insight per portfolio can be `pending` or `running` at a time (returns 409 if attempted). Endpoints: `POST /portfolio/{id}/insights/generate` (202), `GET /portfolio/{id}/insights/latest`, `GET /portfolio/{id}/insights`, `GET /portfolio/{id}/insights/{insight_id}`.

### Deployment

`docker-compose.yml` runs four services: `db` (postgres:16), `backend`, `frontend`, `nginx`. The backend waits for the `db` healthcheck before starting. Nginx reverse-proxies `/api/` → backend, `/ws/` → backend (with WebSocket upgrade headers), and everything else → frontend. TLS is not included — add certbot separately.
