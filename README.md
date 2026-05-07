# AgentFloor

**A self-hosted web UI for [TradingAgents](https://github.com/TauricResearch/TradingAgents) — run multi-agent LLM stock research as a team.**

> Research only — no order execution.

---

## The Problem

[TradingAgents](https://github.com/TauricResearch/TradingAgents) is a powerful multi-agent framework that deploys specialist LLM agents (market analyst, fundamentals analyst, bull/bear debate, risk manager, and trader) to research a stock. It produces deeply reasoned reports — but it runs as a Python script, stores results in local files, and has no shared interface for teams.

AgentFloor wraps TradingAgents in a production-quality web application so that multiple people can launch analyses, watch agents think in real time, and review or download structured reports — without touching a terminal.

---

## What AgentFloor adds

| Capability | Detail |
|---|---|
| **Web UI** | Launch runs, monitor live agent streams, review results in a browser |
| **Team access** | Invite-based registration, admin / member roles, shared run history |
| **Run history** | Filter by ticker, verdict, or user; archive or delete old runs |
| **Live monitoring** | Real-time WebSocket feed of every agent event as it happens |
| **Structured reports** | Verdict (BUY / SELL / HOLD), price levels, per-analyst reports, bull/bear debate |
| **Export** | Download any completed report as **PDF**, **Markdown**, or **JSON** |
| **Watchlist & scheduling** | Track tickers with recurring schedules (daily, weekdays, weekly, custom days) — runs fire automatically via APScheduler |
| **Run comparison** | Select two completed runs via checkboxes in the history table and click "Compare 2 runs →", or open any run and click "Compare →" to pick a second run from a list — no URL editing required |
| **Outcome tracking** | After each run, prices are fetched at +7d/+14d/+30d/+90d via Finnhub; a performance page shows accuracy stats across all runs |
| **Portfolio tracker** | Upload a broker CSV to track holdings with live prices, unrealized P&L, and last analysis verdict per ticker; edit rows inline (add/modify/delete) or export to CSV |
| **AI Portfolio Insights** | One-click AI briefing for your entire portfolio: health score (1–10), stance (bullish/bearish/neutral/mixed), prioritised action items per holding (BUY MORE / TRIM / EXIT / WATCH / REANALYZE), risk alerts (concentration, drawdown, stale analysis, sector overweight), sector exposure chart, and strengths/weaknesses. Also fires automatically every weekday morning via APScheduler. |
| **Multiple LLM providers** | OpenAI, Anthropic, Google, Groq, and more — configurable per run; Ollama/vLLM for local inference |
| **Secure API key storage** | Provider keys stored encrypted at rest |
| **One-command deploy** | Docker Compose stack: Postgres + FastAPI + Next.js + Nginx |

---

## Quick install (Linux / macOS)

The installer pulls pre-built Docker images, generates secrets, and starts the stack in one command:

```bash
curl -fsSL https://raw.githubusercontent.com/saketnayak/trading-command-center/main/install.sh | bash
```

Then open **http://localhost** and register your admin account.

**Manage the running stack:**

```bash
agentfloor update    # pull the latest version
agentfloor logs      # stream logs
agentfloor stop      # shut down
```

> **Windows:** see `install.ps1` in the repo root for the PowerShell equivalent.

---

## Manual setup (development)

### Prerequisites

- Python 3.12+
- Node.js 20+
- Docker (for Postgres, or the full stack)

### 1. Clone and start Postgres

```bash
git clone https://github.com/saketnayak/trading-command-center
cd trading-command-center

docker compose up db -d
```

Postgres starts on **port 5433** to avoid conflicts with any local instance on 5432.

### 2. Backend

```bash
cd backend

pip install uv
uv pip install --system -e ".[dev]"

cp .env.example .env          # edit: set JWT_SECRET and ENCRYPTION_KEY at minimum

DATABASE_URL=postgresql://agentfloor:agentfloor@localhost:5433/agentfloor \
  alembic upgrade head

python -m uvicorn main:app --reload
```

API at **http://localhost:8000** · Swagger docs at **http://localhost:8000/docs**

### 3. Frontend

```bash
cd frontend

npm install
npm run dev
```

App at **http://localhost:3000**

### First login

Go to `/register` — the first user automatically becomes **admin**. All subsequent users need an invite link. As admin, go to **Settings → Team**, enter an email, and click **Invite Member**. If SMTP is configured, the link is emailed; otherwise it appears inline in the UI for copy-paste.

---

## Full-stack Docker

```bash
cp .env.example .env          # fill in all required variables
docker compose up --build
```

Nginx listens on port 80 and routes:
- `/api/*` → FastAPI backend
- `/ws/*` → FastAPI WebSocket (with upgrade headers)
- `/*` → Next.js frontend

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | ✓ | Signs JWT access tokens |
| `ENCRYPTION_KEY` | ✓ | 64 hex chars — encrypts stored API keys |
| `NEXTAUTH_SECRET` | ✓ | Signs NextAuth session cookies |
| `NEXTAUTH_URL` | ✓ | Public URL of the frontend (e.g. `http://localhost`) |
| `DATABASE_URL` | | Defaults to local Postgres on 5432 |
| `OPENAI_API_KEY` | | Pre-seed OpenAI key for all users (optional) |
| `GOOGLE_CLIENT_ID` | | Enables Google OAuth on the login page |
| `GOOGLE_CLIENT_SECRET` | | Enables Google OAuth on the login page |
| `SMTP_HOST` | | Outbound email for invite links (invite links are printed to logs if unset) |
| `SMTP_USER` | | |
| `SMTP_PASSWORD` | | |
| `SMTP_FROM` | | From address for invite emails |
| `VLLM_BASE_URL` | | Base URL for a local vLLM server (default `http://localhost:8080`) |

**Provider API keys** (entered via the Settings page, stored encrypted):

| Provider key | Purpose |
|---|---|
| `openai`, `anthropic`, `google`, `groq`, … | LLM inference for runs |
| `finnhub` | Live portfolio prices (free tier: 60 req/min, no daily cap) and historical closing prices for outcome tracking (+7d/+14d/+30d/+90d via the `/stock/candle` endpoint). Without this key, portfolio prices and OutcomeCard price columns show `—`. Get a free key at [finnhub.io](https://finnhub.io). |

See `.env.example` for the full list with defaults.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│  Next.js 14 App Router · TanStack Query · WS     │
└────────────────────┬────────────────────────────┘
                     │ HTTP / WebSocket
              ┌──────▼──────┐
              │    Nginx     │
              └──────┬──────┘
          ┌──────────┴──────────┐
          │                     │
   ┌──────▼──────┐       ┌──────▼──────┐
   │   FastAPI    │       │  Next.js    │
   │  + SQLAlchemy│       │  (server)   │
   └──────┬──────┘       └─────────────┘
          │
   ┌──────▼──────┐
   │  PostgreSQL  │
   └─────────────┘
          │
   ┌──────▼─────────────────────────┐
   │  TradingAgents (Python thread) │
   │  market · fundamentals ·       │
   │  sentiment · news · trader     │
   └────────────────────────────────┘
```

**Run lifecycle:**
1. User submits a run → `POST /runs` creates a DB row and starts an `asyncio.Task`
2. The task runs `TradingAgentsGraph.propagate()` in a thread pool (it's synchronous)
3. A LangChain callback captures every agent token and routes it to an `asyncio.Queue`
4. A drain coroutine writes `AgentEvent` rows to Postgres and broadcasts over WebSocket
5. The frontend Live page connects via WebSocket and renders events as they arrive
6. On completion, the final state is parsed into a `Report` row and surfaced on the Results page
7. `outcome_service.py` then lazily fetches closing prices from Finnhub (`/stock/candle`) at +7d/+14d/+30d/+90d and persists a `RunOutcome` row (requires a Finnhub API key saved in Settings)

Watchlist runs follow the same lifecycle from step 1 onward — the scheduler simply creates the `Run` row and calls `start_run()` on the configured cron schedule.

**Portfolio Insights lifecycle:**
1. User clicks "Generate Insights" (or the daily 09:15 UTC scheduler fires) → `POST /portfolio/{id}/insights/generate` creates a `PortfolioInsight` row (`status=pending`) and starts an `asyncio.Task`
2. `portfolio_insight_runner.py` fetches live prices + sector metadata from Finnhub, last run verdicts from the DB, builds a structured JSON prompt, and calls the chosen LLM provider directly via httpx
3. The parsed JSON response (health score, action items, risk alerts, sector analysis, strengths/weaknesses) is persisted back to the `portfolio_insights` row (`status=completed`)
4. The frontend polls `GET /portfolio/{id}/insights/latest` every 2 s while `status` is `pending`/`running`, then renders the full insight view on completion

---

## Project structure

```
backend/
  main.py                  # FastAPI app, router mounts, lifespan (scheduler)
  app/
    routers/               # auth, runs, api_keys, users, llm_providers, watchlist, portfolio
    models/                # User, Run, AgentEvent, Report, ApiKey,
    │                      #   RunOutcome, Watchlist, WatchlistItem,
    │                      #   Portfolio, PortfolioSnapshot, PortfolioHolding,
    │                      #   PortfolioInsight
    services/              # auth, encryption, email, websocket_manager,
    │                      #   job_manager, trading_agent_runner,
    │                      #   outcome_service (Finnhub), scheduler,
    │                      #   portfolio_insight_runner
    schemas/               # Pydantic request/response models
    config.py              # pydantic-settings — all env vars
  tests/
  alembic/                 # database migrations

frontend/
  app/                     # Next.js App Router pages
    runs/                  # list, new, [id]/live, [id] (results)
    │                      #   compare (side-by-side), performance (outcome stats)
    watchlist/             # ticker watchlist + visual schedule builder
    portfolio/             # portfolio manager (CSV upload, live prices, inline editing)
    settings/
  components/
    runs/                  # RunTable, RunForm, RunFilters, StatsBar,
    │                      #   TraderDecision, AnalystReports, BullBearDebate,
    │                      #   DownloadMenu, ComparisonPanel, OutcomeCard,
    │                      #   PipelinePanel, AgentFeed, AgentSidebar
    portfolio/             # PortfolioSwitcher, PortfolioHeader, UploadDrawer,
    │                      #   HoldingsTable, InsightsDashboard
    layout/                # TopNav
    ui/                    # Markdown renderer, shared primitives
  lib/
    api.ts                 # typed API client (fetchWithAuth)
    types.ts               # shared TypeScript types
    websocket.ts           # useAgentStream hook
    export/                # buildMarkdown, ReportPdf, parseMdForPdf
```

---

## Running tests

```bash
cd backend

python -m pytest                                              # all tests
python -m pytest tests/test_auth.py                          # single file
python -m pytest tests/test_auth.py::test_register_first_user_is_admin
```

Tests require a running Postgres instance (`docker compose up db -d`). The test suite truncates all tables at session start so reruns are safe.

Frontend export utilities have their own tests:

```bash
cd frontend
npx tsx --test lib/export/buildMarkdown.test.ts
npx tsx --test lib/export/parseMdForPdf.test.ts
```

---

## Contributing

Issues and pull requests are welcome. For larger changes, open an issue first to discuss the approach.

---

## License

MIT
