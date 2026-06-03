#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
STATE_DIR="${DEV_STACK_STATE_DIR:-$ROOT_DIR/.dev-stack}"
LOG_DIR="$STATE_DIR/logs"
PID_DIR="$STATE_DIR/pids"

DEFAULT_DATABASE_URL="postgresql://agentfloor:agentfloor@localhost:5433/agentfloor"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:$BACKEND_PORT}"

mkdir -p "$LOG_DIR" "$PID_DIR"

if [[ -f "$BACKEND_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$BACKEND_DIR/.env"
  set +a
fi

DATABASE_URL="${DATABASE_URL:-$DEFAULT_DATABASE_URL}"

usage() {
  cat <<EOF
Usage: scripts/dev-stack.sh <command>

Commands:
  status           Show backend/frontend/database status
  db-check         Verify the database is reachable
  migrate          Run alembic upgrade head after db-check
  start-backend    Start FastAPI dev server on $BACKEND_HOST:$BACKEND_PORT
  stop-backend     Stop backend started by this script
  start-frontend   Start Next.js dev server on $FRONTEND_HOST:$FRONTEND_PORT
  stop-frontend    Stop frontend started by this script
  start            Run db-check, migrate, start backend, start frontend
  stop             Stop frontend and backend
  restart          Stop, then start

Environment overrides:
  DATABASE_URL, BACKEND_HOST, BACKEND_PORT, FRONTEND_HOST, FRONTEND_PORT,
  NEXT_PUBLIC_API_URL, DEV_STACK_STATE_DIR
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

pid_file() {
  echo "$PID_DIR/$1.pid"
}

is_pid_running() {
  local file="$1"
  [[ -f "$file" ]] && kill -0 "$(cat "$file")" >/dev/null 2>&1
}

port_listener() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 {print $1 " pid=" $2 " " $9}'
  fi
}

port_is_listening() {
  [[ -n "$(port_listener "$1")" ]]
}

db_check() {
  require_cmd uv
  echo "Checking database..."
  (
    cd "$BACKEND_DIR"
    DATABASE_URL="$DATABASE_URL" uv run python - <<'PY'
import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def async_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    engine = create_async_engine(async_url(os.environ["DATABASE_URL"]))
    try:
        async with engine.connect() as conn:
            await conn.execute(text("select 1"))
    finally:
        await engine.dispose()


asyncio.run(main())
PY
  )
  echo "Database reachable."
}

migrate() {
  require_cmd uv
  db_check
  echo "Running alembic upgrade head..."
  (
    cd "$BACKEND_DIR"
    DATABASE_URL="$DATABASE_URL" uv run alembic upgrade head
  )
  echo "Migration complete."
}

start_backend() {
  require_cmd uv
  local file
  file="$(pid_file backend)"

  if is_pid_running "$file"; then
    echo "Backend already started by this script (pid $(cat "$file"))."
    return
  fi
  if port_is_listening "$BACKEND_PORT"; then
    echo "Backend port $BACKEND_PORT is already in use:"
    port_listener "$BACKEND_PORT"
    echo "Not starting another backend."
    return
  fi

  echo "Starting backend on http://$BACKEND_HOST:$BACKEND_PORT ..."
  (
    cd "$BACKEND_DIR"
    exec env DATABASE_URL="$DATABASE_URL" uv run python -m uvicorn main:app \
      --reload \
      --host "$BACKEND_HOST" \
      --port "$BACKEND_PORT"
  ) >"$LOG_DIR/backend.log" 2>&1 &
  echo "$!" > "$file"
  echo "Backend pid $(cat "$file"), log: $LOG_DIR/backend.log"
}

stop_service() {
  local name="$1"
  local file
  file="$(pid_file "$name")"

  if ! [[ -f "$file" ]]; then
    echo "$name is not tracked by this script."
    return
  fi

  local pid
  pid="$(cat "$file")"
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "$name pid $pid is not running."
    rm -f "$file"
    return
  fi

  echo "Stopping $name pid $pid ..."
  pkill -TERM -P "$pid" >/dev/null 2>&1 || true
  kill -TERM "$pid" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$file"
      echo "$name stopped."
      return
    fi
    sleep 0.25
  done

  echo "$name did not stop after SIGTERM; sending SIGKILL."
  pkill -KILL -P "$pid" >/dev/null 2>&1 || true
  kill -KILL "$pid" >/dev/null 2>&1 || true
  rm -f "$file"
}

start_frontend() {
  require_cmd npm
  local file
  file="$(pid_file frontend)"

  if is_pid_running "$file"; then
    echo "Frontend already started by this script (pid $(cat "$file"))."
    return
  fi
  if port_is_listening "$FRONTEND_PORT"; then
    echo "Frontend port $FRONTEND_PORT is already in use:"
    port_listener "$FRONTEND_PORT"
    echo "Not starting another frontend."
    return
  fi

  echo "Starting frontend on http://$FRONTEND_HOST:$FRONTEND_PORT ..."
  (
    cd "$FRONTEND_DIR"
    exec env NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" npm run dev -- \
      --hostname "$FRONTEND_HOST" \
      --port "$FRONTEND_PORT"
  ) >"$LOG_DIR/frontend.log" 2>&1 &
  echo "$!" > "$file"
  echo "Frontend pid $(cat "$file"), log: $LOG_DIR/frontend.log"
}

status() {
  local backend_pid_file frontend_pid_file
  backend_pid_file="$(pid_file backend)"
  frontend_pid_file="$(pid_file frontend)"

  echo "Backend:"
  if is_pid_running "$backend_pid_file"; then
    echo "  tracked pid: $(cat "$backend_pid_file")"
  else
    echo "  tracked pid: none"
  fi
  if port_is_listening "$BACKEND_PORT"; then
    port_listener "$BACKEND_PORT" | sed 's/^/  listening: /'
  else
    echo "  port $BACKEND_PORT: not listening"
  fi

  echo "Frontend:"
  if is_pid_running "$frontend_pid_file"; then
    echo "  tracked pid: $(cat "$frontend_pid_file")"
  else
    echo "  tracked pid: none"
  fi
  if port_is_listening "$FRONTEND_PORT"; then
    port_listener "$FRONTEND_PORT" | sed 's/^/  listening: /'
  else
    echo "  port $FRONTEND_PORT: not listening"
  fi

  echo "Database:"
  if db_check >/dev/null 2>&1; then
    echo "  reachable via DATABASE_URL"
  else
    echo "  not reachable via DATABASE_URL"
    return 1
  fi
}

case "${1:-}" in
  status) status ;;
  db-check) db_check ;;
  migrate) migrate ;;
  start-backend) start_backend ;;
  stop-backend) stop_service backend ;;
  start-frontend) start_frontend ;;
  stop-frontend) stop_service frontend ;;
  start)
    migrate
    start_backend
    start_frontend
    ;;
  stop)
    stop_service frontend
    stop_service backend
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  ""|-h|--help|help) usage ;;
  *)
    echo "Unknown command: $1" >&2
    usage >&2
    exit 1
    ;;
esac
