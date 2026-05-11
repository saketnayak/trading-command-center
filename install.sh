#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.agentfloor"
VERSION="${AGENTFLOOR_VERSION:-latest}"
REPO_REF="${AGENTFLOOR_VERSION:-main}"
REPO_RAW="https://raw.githubusercontent.com/saketnayak/trading-command-center/${REPO_REF}"

# ── colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[agentfloor]${RESET} $*"; }
success() { echo -e "${GREEN}[agentfloor]${RESET} $*"; }
fatal()   { echo -e "${RED}[agentfloor] ERROR:${RESET} $*" >&2; exit 1; }

# ── 1/7  check docker ──────────────────────────────────────────────────────
info "[1/7] Checking Docker..."
command -v docker >/dev/null 2>&1 || fatal "Docker not found. Install it from https://docker.com then re-run this script."
docker compose version >/dev/null 2>&1 || fatal "Docker Compose plugin not found. Install Docker Desktop or 'docker compose' plugin."
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1)
[ "${DOCKER_VERSION:-0}" -ge 24 ] 2>/dev/null || fatal "Docker >= 24 required (found ${DOCKER_VERSION:-unknown}). Please upgrade."
success "Docker OK"

# ── 2/7  install directory ─────────────────────────────────────────────────
info "[2/7] Creating install directory at $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

# ── 3/7  download files ────────────────────────────────────────────────────
info "[3/7] Downloading configuration files..."
curl -fsSL "$REPO_RAW/docker-compose.prod.yml" -o "$INSTALL_DIR/docker-compose.yml"
curl -fsSL "$REPO_RAW/nginx.conf"              -o "$INSTALL_DIR/nginx.conf"

# pin version if requested
if [ "$VERSION" != "latest" ]; then
  sed -i.bak "s|:latest|:${VERSION}|g" "$INSTALL_DIR/docker-compose.yml" && rm -f "$INSTALL_DIR/docker-compose.yml.bak"
  info "Pinned to version $VERSION"
fi

# ── 4/7  generate secrets ──────────────────────────────────────────────────
info "[4/7] Generating secrets..."
if [ -f "$INSTALL_DIR/.env" ]; then
  info ".env already exists — keeping existing secrets."
  # shellcheck disable=SC1090
  set -a; source "$INSTALL_DIR/.env"; set +a
else
  JWT_SECRET=$(openssl rand -hex 32)
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  NEXTAUTH_SECRET=$(openssl rand -hex 32)
  GENERATE_ENV=1
fi

# ── 5/7  prompt for optional values ───────────────────────────────────────
if [ "${GENERATE_ENV:-0}" = "1" ]; then
  if [ -t 0 ]; then
    # stdin is a terminal — safe to prompt interactively
    echo ""
    read -rp "Enter your OpenAI API key       (press Enter to skip): " OPENAI_API_KEY
    read -rp "Public URL of this install      (default: http://localhost): " NEXTAUTH_URL
    NEXTAUTH_URL="${NEXTAUTH_URL:-http://localhost}"
    echo ""
  else
    # stdin is a pipe (e.g. curl | bash) — reading would consume script bytes
    OPENAI_API_KEY=""
    NEXTAUTH_URL="http://localhost"
    info "Non-interactive session — using defaults (NEXTAUTH_URL=http://localhost)."
    info "Edit $INSTALL_DIR/.env to set NEXTAUTH_URL to your server's public address."
    echo ""
  fi

# ── 6/7  write .env ───────────────────────────────────────────────────────
  info "[6/7] Writing $INSTALL_DIR/.env..."
  cat > "$INSTALL_DIR/.env" <<EOF
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXTAUTH_URL=${NEXTAUTH_URL}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@agentfloor.local
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
EOF
  chmod 600 "$INSTALL_DIR/.env"
else
  info "[6/7] Using existing .env."
fi

# ── 7/7  start the stack ───────────────────────────────────────────────────
info "[7/7] Starting AgentFloor..."
docker compose --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/docker-compose.yml" up -d

info "Waiting for AgentFloor to be ready (up to 90s)..."
TIMEOUT=90; ELAPSED=0
until curl -sf http://localhost/api/health >/dev/null 2>&1; do
  sleep 2; ELAPSED=$((ELAPSED + 2))
  [ "$ELAPSED" -ge "$TIMEOUT" ] && fatal "Timed out. Check logs with: docker compose --env-file $INSTALL_DIR/.env -f $INSTALL_DIR/docker-compose.yml logs"
done

# ── install the agentfloor alias ───────────────────────────────────────────
ALIAS_BLOCK='
# AgentFloor management alias — added by installer
agentfloor() {
  local DC="docker compose --env-file $HOME/.agentfloor/.env -f $HOME/.agentfloor/docker-compose.yml"
  case "$1" in
    update)
      # Pull latest images and restart app containers; db is left untouched.
      $DC pull backend frontend nginx \
        && $DC up -d --no-deps backend frontend nginx ;;
    restart)
      # Restart only app containers — never touches db so data is always safe.
      $DC restart backend frontend nginx ;;
    stop)
      # Stop all containers (db data is preserved in the named volume).
      $DC stop ;;
    start)
      $DC up -d ;;
    logs)
      $DC logs -f "${2:-}" ;;
    status)
      $DC ps ;;
    *)
      $DC "$@" ;;
  esac
}'

for RC in "$HOME/.zshrc" "$HOME/.bashrc"; do
  if [ -f "$RC" ] && ! grep -q "AgentFloor management alias" "$RC"; then
    echo "$ALIAS_BLOCK" >> "$RC"
  fi
done

# ── success banner ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  AgentFloor is running!${RESET}"
echo -e "  Open ${CYAN}http://localhost${RESET} and register your admin account."
echo ""
echo -e "  ${BOLD}Useful commands (restart your shell first):${RESET}"
echo -e "    agentfloor restart   restart app (db untouched, data safe)"
echo -e "    agentfloor update    pull the latest version"
echo -e "    agentfloor logs      stream all logs"
echo -e "    agentfloor stop      shut down (data preserved)"
echo -e "    agentfloor status    show container status"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
