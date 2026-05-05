# One-Command Install for AgentFloor

**Date:** 2026-05-05  
**Status:** Approved  
**Approach:** Hosted installer + GHCR pre-built images (Option A)

---

## Goal

Let any user install and run AgentFloor with a single terminal command on Mac, Linux, or Windows — no Git, no Node, no Python, no manual secret generation required. Target user: terminal-comfortable but not a DevOps engineer (e.g. a quant researcher or finance developer).

```bash
# Mac / Linux
curl -fsSL https://raw.githubusercontent.com/ORG/agentfloor/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/ORG/agentfloor/main/install.ps1 | iex
```

---

## Architecture

```
GitHub repo (main branch)
    │
    ├── .github/workflows/publish.yml     ← builds & pushes images on merge to main / git tag
    ├── docker-compose.prod.yml           ← references GHCR images (no build: directives)
    ├── nginx.conf                        ← unchanged, downloaded by installer
    ├── install.sh                        ← bash installer (Mac + Linux)
    └── install.ps1                       ← PowerShell installer (Windows)
            │
            ▼
    ~/.agentfloor/           (Mac/Linux)
    %USERPROFILE%\.agentfloor\  (Windows)
        ├── docker-compose.yml
        ├── nginx.conf
        └── .env
```

Five components: CI pipeline, production compose file, two installer scripts, and a management alias.

---

## Component 1: GitHub Actions — Image Publishing

**File:** `.github/workflows/publish.yml`

**Triggers:**
- Push to `main` branch
- Push of a `v*` git tag (e.g. `v1.2.3`)

**Jobs:** Two parallel jobs — `build-backend` and `build-frontend`.

**Image registry:** GitHub Container Registry (GHCR) — `ghcr.io/ORG/agentfloor-backend` and `ghcr.io/ORG/agentfloor-frontend`. Free for public repos. Authenticated via the built-in `GITHUB_TOKEN` (no secrets to configure).

**Tags per build:**

| Tag | When | Purpose |
|---|---|---|
| `:latest` | Every merge to main | Default installer target |
| `:sha-abc1234` | Every merge to main | Pinned rollback reference |
| `:v1.2.3` | On `v*` git tags | Stable pinned installs |

**Frontend runtime config:** `NEXT_PUBLIC_API_URL` must not be baked in at build time — the image needs to work for any hostname. The Next.js config will read `NEXT_PUBLIC_API_URL` from the runtime environment via an entrypoint script that injects it at container start. This allows one image to serve both `http://localhost` and any custom domain.

---

## Component 2: `docker-compose.prod.yml`

The existing `docker-compose.yml` with two changes:
1. `build: ./backend` and `build: ./frontend` replaced with `image:` references
2. Nginx `volumes` path adjusted to be relative to `~/.agentfloor/`

```yaml
services:
  db:
    image: postgres:16-alpine

  backend:
    image: ghcr.io/ORG/agentfloor-backend:latest
    # all environment: entries identical to existing

  frontend:
    image: ghcr.io/ORG/agentfloor-frontend:latest
    # all environment: entries identical to existing

  nginx:
    image: nginx:alpine
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro

volumes:
  agentfloor_pgdata:
```

The backend `CMD` changes to run migrations before starting uvicorn:

```
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"]
```

This ensures `agentfloor update` applies schema migrations automatically on every restart.

---

## Component 3: `install.sh` (Mac + Linux)

**Invocation:** `curl -fsSL .../install.sh | bash`

### Script steps

```
[1/7] Check Docker
      - Require docker CLI and docker compose plugin, version >= 24
      - On failure: print "Install Docker from https://docker.com then re-run."
      - Exit 1

[2/7] Create install directory
      - mkdir -p ~/.agentfloor

[3/7] Download files
      - docker-compose.prod.yml → ~/.agentfloor/docker-compose.yml
      - nginx.conf              → ~/.agentfloor/nginx.conf

[4/7] Generate secrets (no user input needed)
      - JWT_SECRET      = openssl rand -hex 32
      - ENCRYPTION_KEY  = openssl rand -hex 32  (32 bytes = 64 hex chars)
      - NEXTAUTH_SECRET = openssl rand -hex 32

[5/7] Prompt for optional values
      - "Enter your OpenAI API key (press Enter to skip): "
      - "Enter your Alpha Vantage key (press Enter to skip): "
      - NEXTAUTH_URL defaults to http://localhost

[6/7] Write ~/.agentfloor/.env
      - chmod 600 (owner read/write only)
      - Skip secret regeneration if .env already exists (reinstall safety)

[7/7] Start the stack
      - docker compose -f ~/.agentfloor/docker-compose.yml up -d
      - Poll http://localhost/health every 2s, timeout 90s
        (backend exposes GET /health → 200 {"status":"ok"}, added as part of this feature)
      - On success: print success banner
      - On timeout: print "Run: agentfloor logs"
```

### Success banner

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AgentFloor is running at http://localhost
  Open it in your browser and register your admin account.

  Useful commands:
    agentfloor update   pull latest version
    agentfloor logs     stream logs
    agentfloor stop     shut down
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Management alias

Appended to `~/.zshrc` and `~/.bashrc` (whichever exist):

```bash
agentfloor() {
  case "$1" in
    update) docker compose -f "$HOME/.agentfloor/docker-compose.yml" pull \
              && docker compose -f "$HOME/.agentfloor/docker-compose.yml" up -d ;;
    logs)   docker compose -f "$HOME/.agentfloor/docker-compose.yml" logs -f ;;
    *)      docker compose -f "$HOME/.agentfloor/docker-compose.yml" "$@" ;;
  esac
}
```

### Pinned version install

```bash
AGENTFLOOR_VERSION=v1.2.3 curl -fsSL .../install.sh | bash
```

When `AGENTFLOOR_VERSION` is set, the script rewrites `:latest` to `:v1.2.3` in the downloaded compose file before writing it.

---

## Component 4: `install.ps1` (Windows)

**Invocation:** `irm .../install.ps1 | iex`

Identical logic to `install.sh` using PowerShell equivalents:

| Bash | PowerShell |
|---|---|
| `openssl rand -hex 32` | `[System.BitConverter]::ToString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).Replace('-','').ToLower()` |
| `read -p "..."` | `Read-Host "..."` |
| `~/.agentfloor/` | `$env:USERPROFILE\.agentfloor\` |
| `chmod 600 .env` | `icacls` ACL restriction to current user |
| `~/.zshrc` alias | PowerShell `$PROFILE` function |

Docker Desktop on Windows supports `docker compose` natively in PowerShell — WSL2 is not required. WSL2 users can use `install.sh` directly.

---

## Component 5: Management Commands

Available after install via the `agentfloor` alias / PowerShell function:

| Command | Action |
|---|---|
| `agentfloor start` | `docker compose up -d` |
| `agentfloor stop` | `docker compose down` |
| `agentfloor update` | `docker compose pull && docker compose up -d` |
| `agentfloor logs` | `docker compose logs -f` |
| `agentfloor status` | `docker compose ps` |
| `agentfloor restart` | `docker compose restart` |

---

## Versioning & Data Safety

- **Default:** `:latest` tag — `agentfloor update` always fetches newest
- **Pinned:** `AGENTFLOOR_VERSION=v1.2.3` env var during install rewrites image tags
- **Postgres data:** stored in named Docker volume `agentfloor_pgdata` — survives `docker compose down` and `agentfloor update`
- **Migrations:** backend entrypoint runs `alembic upgrade head` before uvicorn on every start
- **Reinstall safety:** installer skips secret regeneration if `~/.agentfloor/.env` already exists

---

## Files to Create / Modify

| File | Action |
|---|---|
| `.github/workflows/publish.yml` | Create — CI image build and push |
| `docker-compose.prod.yml` | Create — image-based compose for end users |
| `backend/Dockerfile` | Modify — add migration step to entrypoint |
| `backend/main.py` | Modify — add `GET /health` endpoint returning `{"status":"ok"}` |
| `frontend/next.config.mjs` | Modify — runtime env injection for `NEXT_PUBLIC_API_URL` |
| `install.sh` | Create — bash installer for Mac and Linux |
| `install.ps1` | Create — PowerShell installer for Windows |

---

## Out of Scope

- TLS / HTTPS (users add certbot or Cloudflare separately)
- Automatic update notifications
- Uninstall script (`docker compose down -v && rm -rf ~/.agentfloor` is sufficient)
- Linux systemd service (Docker `restart: unless-stopped` handles reboot persistence)
