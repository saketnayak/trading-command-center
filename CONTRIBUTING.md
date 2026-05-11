# Contributing to AgentFloor

Thanks for your interest! Here's everything you need to get started.

## Local development setup

**Prerequisites:** Docker Desktop, Python 3.11+, Node.js 18+

### Backend

```bash
cd backend
pip install uv && uv pip install --system -e ".[dev]"
docker compose up db -d          # starts Postgres on port 5433
DATABASE_URL=postgresql://agentfloor:agentfloor@localhost:5433/agentfloor alembic upgrade head
python -m uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev    # http://localhost:3000
```

### Running tests

```bash
cd backend
docker compose up db -d
python -m pytest
```

## Pull request guidelines

- One feature or fix per PR — keep them focused
- Match the existing code style; don't reformat surrounding code
- Add or update tests for any changed behavior
- If you change the architecture, update `CLAUDE.md`

## Good first issues

Look for issues tagged [`good first issue`](https://github.com/saketnayak/trading-command-center/issues?q=is%3Aopen+label%3A%22good+first+issue%22) — these are well-scoped tasks with clear acceptance criteria.

## Questions and ideas

Open a [GitHub Discussion](https://github.com/saketnayak/trading-command-center/discussions) — that's the right place for questions, feature ideas, and general conversation before opening a PR.
