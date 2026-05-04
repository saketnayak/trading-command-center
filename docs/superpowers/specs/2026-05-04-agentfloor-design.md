# AgentFloor — Design Spec

**Date:** 2026-05-04  
**Project name:** AgentFloor (`agentfloor`)  
**Status:** Approved — ready for implementation planning

---

## Overview

AgentFloor is a web-based command center UI for the [TradingAgents](https://github.com/TauricResearch/TradingAgents) multi-agent LLM trading framework. It wraps TradingAgents' Python library in a FastAPI backend and a Next.js frontend, giving a small team a shared interface to configure analysis runs, watch agents work in real-time, and review results.

**Scope:** Research and monitoring only. No order execution. No broker integrations in this version (planned for a future phase).

---

## Goals

1. Replace the TradingAgents CLI with a web UI accessible to the whole team from a shared deployment.
2. Stream live per-agent reasoning to the UI during a run (not just raw stdout).
3. Persist all run history, agent events, and reports so any team member can review any past run.
4. Manage LLM and market data API keys centrally (encrypted, admin-controlled).
5. Support email/password and Google OAuth authentication with admin/member roles.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js (App Router) | Best-in-class React framework; NextAuth.js for auth |
| Backend | FastAPI (Python) | Same language as TradingAgents; async-native; WebSocket support |
| TradingAgents integration | Direct Python import | Hook into LangGraph callbacks for structured per-agent events |
| Database | PostgreSQL | Structured data; SQLAlchemy ORM |
| Real-time | WebSockets | Per-run channel; streams agent events to subscribed clients |
| Auth | NextAuth.js + FastAPI JWT | Google OAuth + email/password; JWT tokens for API calls |
| Deployment | Docker Compose | Next.js + FastAPI + PostgreSQL in one compose file |
| Hosting | Railway or DigitalOcean Droplet | Railway for zero-DevOps; Droplet for full VPS control |

---

## Architecture

```
Browser (Next.js)
  ├── REST API  ←→  FastAPI Backend
  └── WebSocket ←→  FastAPI Backend
                        ├── Job Manager (asyncio background tasks)
                        ├── TradingAgents (direct import)
                        │     └── LangGraph callbacks → structured events
                        └── PostgreSQL (SQLAlchemy)

External:
  Alpha Vantage (market data)
  LLM providers (OpenAI, Anthropic, Gemini, DeepSeek, etc.)
  Google OAuth
```

### Key architectural decisions

**LangGraph callbacks for structured streaming.** FastAPI hooks into TradingAgents' LangGraph node callbacks to emit typed events per agent (agent started, token streamed, agent completed, decision made). This gives the frontend rich per-agent status rather than raw stdout.

**WebSocket per run.** Each active run gets its own WebSocket channel (`/ws/runs/{run_id}`). The frontend subscribes when viewing a live run and unsubscribes on navigation. The backend broadcasts events to all subscribers of a run (multiple team members can watch simultaneously).

**All events persisted.** Every agent event emitted during a run is written to the `agent_events` table before being broadcast. The Live Monitor and Results Viewer use the same data — live view = streaming events; results view = replaying persisted events. No separate storage path.

**API keys encrypted in DB.** LLM and Alpha Vantage keys are stored AES-encrypted in the `api_keys` table. They are never in environment files or source code. Each key is validated with a test call before saving. Only admins can create, update, or delete keys.

---

## Database Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| email | TEXT UNIQUE | |
| hashed_password | TEXT NULLABLE | null for OAuth-only accounts |
| name | TEXT | |
| role | ENUM(admin, member) | first user becomes admin |
| google_id | TEXT NULLABLE | for Google OAuth |
| created_at | TIMESTAMP | |

### `runs`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| created_by | UUID FK → users | |
| ticker | TEXT | e.g. "AAPL" |
| analysis_date | DATE | past trading day |
| llm_provider | TEXT | e.g. "openai" |
| llm_model | TEXT | e.g. "gpt-4o" |
| depth | ENUM(quick, standard, deep) | |
| analysts | TEXT[] | enabled analyst names |
| label | TEXT NULLABLE | optional user label |
| status | ENUM(pending, running, completed, aborted, failed) | |
| verdict | ENUM(buy, sell, hold) NULLABLE | denormalized copy of reports.verdict; set on completion for fast table queries |
| started_at | TIMESTAMP NULLABLE | |
| completed_at | TIMESTAMP NULLABLE | |
| created_at | TIMESTAMP | |

### `agent_events`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| run_id | UUID FK → runs | |
| agent_name | TEXT | e.g. "fundamentals_analyst" |
| event_type | ENUM(started, token, completed, error) | |
| payload | JSONB | token text, summary, error message, etc. |
| sequence | INTEGER | ordering within a run |
| created_at | TIMESTAMP | |

### `reports`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| run_id | UUID FK → runs UNIQUE | one report per run |
| trader_decision | TEXT | full trader agent output |
| verdict | ENUM(buy, sell, hold) | |
| suggested_entry | TEXT NULLABLE | |
| suggested_stop | TEXT NULLABLE | |
| suggested_target | TEXT NULLABLE | |
| risk_assessment | TEXT | |
| raw_report | JSONB | full TradingAgents output blob |
| created_at | TIMESTAMP | |

### `api_keys`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| provider | TEXT | e.g. "openai", "alpha_vantage" |
| encrypted_key | TEXT | AES-256 encrypted |
| is_valid | BOOLEAN | last validation result |
| validated_at | TIMESTAMP NULLABLE | |
| created_by | UUID FK → users | |
| updated_at | TIMESTAMP | |

---

## API Routes

### Auth
- `POST /auth/register` — email/password registration
- `POST /auth/login` — returns JWT
- `GET /auth/google` — initiates Google OAuth flow
- `GET /auth/google/callback` — OAuth callback, returns JWT

### Runs
- `GET /runs` — list all runs (filterable by ticker, verdict, user, date range, provider)
- `POST /runs` — create and start a new run
- `GET /runs/{id}` — get run details + report
- `DELETE /runs/{id}` — abort a running run (admin or run owner)
- `WS /ws/runs/{id}` — WebSocket stream of agent events for a run

### Agent Events
- `GET /runs/{id}/events` — paginated list of all events for a completed run

### API Keys (admin only)
- `GET /api-keys` — list configured providers (key values masked)
- `POST /api-keys` — add or update a provider key
- `DELETE /api-keys/{provider}` — remove a key

### Team (admin only)
- `GET /users` — list team members
- `POST /users/invite` — send invite email
- `PATCH /users/{id}` — update role
- `DELETE /users/{id}` — remove member

---

## Screens

### 1. Launch Run
Path: `/runs/new`

Form fields: ticker (validated against Alpha Vantage), analysis date (past trading days only), LLM provider (dropdown populated from configured API keys), research depth (Quick ~5min / Standard ~15min / Deep ~30min), analyst toggles (Fundamentals, Sentiment, News, Technical — Bull/Bear/Trader always included), optional run label.

A "Research only — not financial advice" disclaimer is always visible on this page. On submit: `POST /runs` → redirect to `/runs/{id}/live`.

Right sidebar shows 5 most recent runs for quick re-run reference.

### 2. Live Monitor
Path: `/runs/{id}/live`

Three-panel layout:
- **Left (180px):** Agent list with live status (waiting / active / completed). Run metadata below (ticker, date, LLM, depth, started by).
- **Center (flex):** Streaming feed. Completed agents collapsed to one-line summary. Active agent streams tokens. User can scroll up to review past agent output; "Scroll to live" button snaps back.
- **Right (160px):** Pipeline progress bar (N of 7 agents), ordered pipeline list with status icons, estimated time remaining, Abort button.

Bottom status bar: run ID, WebSocket connection state, estimated remaining time.

On run completion, page transitions automatically to `/runs/{id}` (Results Viewer).

### 3. Results Viewer
Path: `/runs/{id}`

Header: ticker, date, LLM, depth, run by, duration. Export PDF and Re-run actions.

**Trader Decision hero card** — always at top. Shows BUY/SELL/HOLD verdict with conviction level, full trader reasoning, suggested entry/stop/target levels. "Research only — not financial advice" disclaimer always visible.

**Tabs:**
- *Analyst Reports* — one card per analyst with signal indicator (bullish/bearish/mixed) and full text
- *Bull vs Bear* — debate transcript between Bull Researcher and Bear Researcher (round by round)
- *Risk Assessment* — Risk Manager's evaluation and approval/rejection
- *Raw Agent Log* — full chronological event log, replayable

**Right panel (140px):** Per-agent signal scorecard (color dot per agent), overall verdict badge, Compare button (load another run for side-by-side).

### 4. Run History
Path: `/runs`

Filterable table of all team runs. Columns: ticker, label, date, verdict, depth, LLM provider, run by, duration.

Filters: free-text search (ticker/label/user), verdict dropdown, provider dropdown, user dropdown, date range picker. Filters persist in URL query params (bookmarkable).

Aborted/failed runs shown at reduced opacity; partial logs accessible. Row click → Results Viewer. Pagination: 20 rows + "load more".

### 5. Settings
Path: `/settings`

Left nav sections: Profile, Security (account); API Keys, Team Members, Deployment (admin-only).

**API Keys:** One row per provider. Shows masked key, validation status (valid/missing/invalid), edit/add action. Keys validated with a test call on save. Providers not yet configured shown with "Add" affordance.

**Team Members:** List of users with admin/member badges. "Invite member" sends an email with a sign-up link. Admin can change roles or remove members.

**Auth:** Toggle display for Google OAuth and email/password (both enabled by default).

**Deployment (admin):** TradingAgents version/commit, DB size, runs today.

---

## Authentication Flow

1. User visits any protected route → redirected to `/login`
2. Login options: email/password form, or "Continue with Google" button
3. On success: NextAuth.js issues a session; Next.js middleware attaches JWT to API requests
4. FastAPI validates JWT on every request; role claim used to gate admin endpoints
5. Invite flow: admin triggers `POST /users/invite` → FastAPI sends email with signed token link → recipient visits `/register?token=...` → sets password and account created

First user to register is automatically assigned admin role.

---

## TradingAgents Integration

FastAPI imports `TradingAgentsGraph` from the `tradingagents` package. On `POST /runs`, a background asyncio task is created:

```python
async def run_agent_task(run_id, config):
    graph = TradingAgentsGraph(config)
    async for event in graph.astream_events(config):
        await persist_event(run_id, event)
        await broadcast_event(run_id, event)
```

**Implementation risk:** TradingAgents may not expose `astream_events` directly. If not, the integration layer will patch LangGraph's node callbacks manually (e.g. via `RunnableConfig` callbacks) to produce the same typed event stream. This is a day-one discovery task before building the streaming infrastructure.

LangGraph's `astream_events` API emits typed events per node. Each event is:
1. Written to `agent_events` table (persisted)
2. Broadcast to all WebSocket subscribers of that run

Agent name is extracted from the LangGraph node name. The event payload includes the token text (for streaming) or the full agent output (on node completion).

---

## Deployment

Docker Compose with three services:
- `frontend` — Next.js, port 3000
- `backend` — FastAPI (uvicorn), port 8000
- `db` — PostgreSQL 16, port 5432 (internal only)

An Nginx reverse proxy (or Railway's built-in routing) routes:
- `/api/*` and `/ws/*` → backend
- Everything else → frontend

Environment variables (set in Railway dashboard or `.env` on Droplet):
- `DATABASE_URL`
- `JWT_SECRET`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `ENCRYPTION_KEY` (for API key encryption at rest)
- `SMTP_*` (for invite emails)

`.env` files are never committed to git. `.gitignore` includes `.env`, `.env.*`, `.superpowers/`.

---

## Out of Scope (This Version)

- Real or paper trade execution (Phase 2)
- Broker API integrations (Alpaca, IBKR, etc.) (Phase 2)
- Multi-tenant / SaaS (single shared instance only)
- Mobile app
- Notifications (email/Slack alerts on run completion)
- Scheduled/recurring runs
