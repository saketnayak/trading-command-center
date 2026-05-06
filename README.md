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
| **Multiple LLM providers** | OpenAI, Anthropic, Google, Groq, and more — configurable per run |
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

Go to `/register` — the first user automatically becomes **admin**. All subsequent users need an invite link generated from the Settings page.

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

---

## Project structure

```
backend/
  main.py                  # FastAPI app, router mounts, CORS
  app/
    routers/               # auth, runs, api_keys, users, llm_providers
    models/                # SQLAlchemy ORM: User, Run, AgentEvent, Report, ApiKey
    services/              # auth, encryption, email, websocket_manager,
    │                      #   job_manager, trading_agent_runner
    schemas/               # Pydantic request/response models
    config.py              # pydantic-settings — all env vars
  tests/
  alembic/                 # database migrations

frontend/
  app/                     # Next.js App Router pages
    runs/                  # list, new, [id]/live, [id] (results)
    settings/
  components/
    runs/                  # RunTable, TraderDecision, AnalystReports,
    │                      #   BullBearDebate, DownloadMenu, …
    layout/                # TopNav
    ui/                    # Markdown renderer
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
