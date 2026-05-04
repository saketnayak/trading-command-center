# AgentFloor

A web UI for running [TradingAgents](https://github.com/TauricResearch/TradingAgents) — a multi-agent LLM framework for stock research. AgentFloor wraps the framework in a team-accessible interface for launching analysis runs, watching agents work in real time, and reviewing results. Research only — no order execution.

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, SQLAlchemy 2 (async), PostgreSQL, Alembic |
| Auth | PyJWT + bcrypt, NextAuth v4, optional Google OAuth |
| Agent execution | TradingAgents + LangChain callbacks, asyncio task pool |
| Frontend | Next.js 14 App Router, TypeScript, Tailwind CSS |
| Real-time | WebSocket per run (`/ws/runs/{id}`) |
| Deployment | Docker Compose + Nginx |

## Getting started

### Prerequisites

- Python 3.12+
- Node.js 20+
- Docker (for Postgres, or full stack)

### 1. Start Postgres

```bash
docker compose up db -d
```

This starts Postgres on **port 5433** (mapped away from 5432 to avoid conflicts).

### 2. Backend

```bash
cd backend
pip install uv
uv pip install --system -e ".[dev]"

cp .env.example .env  # fill in JWT_SECRET, ENCRYPTION_KEY at minimum

DATABASE_URL=postgresql://agentfloor:agentfloor@localhost:5433/agentfloor alembic upgrade head
python -m uvicorn main:app --reload
```

API is available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local  # fill in NEXTAUTH_SECRET

npm run dev
```

App is available at `http://localhost:3000`.

### First login

Register at `/register` — the first user is automatically given the `admin` role. Subsequent users require an invite link generated from the Settings page.

## Full stack with Docker

```bash
cp .env.example .env  # fill in all required secrets
docker compose up --build
```

Nginx listens on port 80 and routes:
- `/api/*` → FastAPI backend
- `/ws/*` → FastAPI WebSocket
- `/*` → Next.js frontend

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | ✓ | Signs JWT tokens |
| `ENCRYPTION_KEY` | ✓ | 64 hex chars (32 bytes) — encrypts stored API keys |
| `NEXTAUTH_SECRET` | ✓ | Signs NextAuth session tokens |
| `NEXTAUTH_URL` | ✓ | Public URL of the frontend (e.g. `http://localhost`) |
| `DATABASE_URL` | | Defaults to `postgresql://agentfloor:agentfloor@localhost:5432/agentfloor` |
| `GOOGLE_CLIENT_ID` | | Enables Google OAuth on the login page |
| `GOOGLE_CLIENT_SECRET` | | Enables Google OAuth on the login page |
| `SMTP_HOST` | | Outbound email for invite links (stub mode if unset) |
| `SMTP_USER` | | |
| `SMTP_PASSWORD` | | |
| `SMTP_FROM` | | From address for invite emails |

See `.env.example` for a full list with defaults.

## Running tests

```bash
cd backend
python -m pytest                          # all tests
python -m pytest tests/test_auth.py       # single file
python -m pytest tests/test_auth.py::test_register_first_user_is_admin  # single test
```

Tests require a running Postgres instance. The test suite truncates all tables at the start of each session, so reruns are safe.

## Project structure

```
backend/
  app/
    routers/       # auth, runs, api_keys, users
    models/        # SQLAlchemy ORM (User, Run, AgentEvent, Report, ApiKey)
    services/      # auth, encryption, email, websocket_manager, job_manager, trading_agent_runner
    schemas/       # Pydantic request/response models
  tests/
  alembic/         # migrations

frontend/
  app/             # Next.js App Router pages
  components/      # runs/, settings/, layout/
  lib/             # api.ts, types.ts, auth.ts, websocket.ts
```
