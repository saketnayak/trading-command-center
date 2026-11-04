# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AgentFloor is a web UI wrapping the [TradingAgents](https://github.com/TauricResearch/TradingAgents) Python multi-agent LLM framework. It is **research-only** — no order execution, with one fenced exception: the opt-in JEV Lab module can place Alpaca *paper* orders (never live; see JEV Lab below). The stack is FastAPI + async SQLAlchemy 2 + PostgreSQL (backend) and Next.js 16 App Router + NextAuth v4 + TanStack Query v5 + Tailwind CSS v4 (frontend).

---

## Commands

### Backend

```bash
cd backend

# Install (uv manages the virtualenv automatically)
pip install uv && uv sync --group dev --extra markov-hmm

# Run dev server
python -m uvicorn main:app --reload

# Run all tests (requires running Postgres; see docker-compose.dev.yml for the db service)
python -m pytest

# Run a single test file / test
python -m pytest tests/test_auth.py
python -m pytest tests/test_auth.py::test_register_first_user_is_admin

# Database migrations
DATABASE_URL=postgresql://agentfloor:agentfloor@localhost:5433/agentfloor alembic upgrade head
DATABASE_URL=postgresql://agentfloor:agentfloor@localhost:5433/agentfloor alembic revision --autogenerate -m "description"
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

docker compose -f docker-compose.dev.yml up --build        # starts db, backend, frontend, nginx
docker compose -f docker-compose.dev.yml up db             # just postgres (for local backend dev)
```

Local Postgres from `docker compose -f docker-compose.dev.yml up db` is mapped to **port 5433** (not 5432) to avoid conflicts.

---

## Architecture

### Backend (`backend/`)

`main.py` mounts routers and manages the APScheduler lifespan:

| Prefix | Router | Purpose |
|---|---|---|
| `/auth` | `auth.py` | Register, login, Google OAuth, invite tokens |
| (none) | `runs.py` | Run CRUD, report, compare, performance, outcome |
| `/api-keys` | `api_keys.py` | Encrypted provider key storage |
| `/users` | `users.py` | Profile, team admin |
| `/llm-providers` | `llm_providers.py` | Static model lists + live local server queries (Ollama/vLLM/IONOS) |
| (none) | `watchlist.py` | Watchlist CRUD, schedule management, manual run trigger, scheduler diagnostics (`GET /watchlist/scheduler/jobs`) |
| (none) | `portfolio.py` | Portfolio CRUD, CSV snapshot upload, holding-level add/edit/delete, live price enrichment, CSV export, AI insight generation/listing, batch run queuing, Finnhub earnings/fundamentals/news data |
| `/regime` | `regime.py` | Markov regime detection — `GET /regime/{ticker}` returns current regime (Bull/Sideways/Bear), signal, Sharpe, max drawdown, and 3×3 transition matrix |
| (none) | `wave.py` | Elliott Wave + Fibonacci analysis — `GET /wave/{ticker}` (compact summary), `POST /wave/{ticker}/analyze` (full chart payload), `GET /portfolio/{id}/wave` (batch for all holdings) |
| (none) | `market.py` | Market-wide data — `GET /market/trending`, `GET /market/movers`. Sources Yahoo Finance trending list + Finnhub quotes. Requires Finnhub key; returns empty gracefully without one. |
| (none) | `jev.py` | JEV Lab (experimental, behind `settings.enable_jev_loop`, 404 while off) — `/jev/meta`, `/jev/symbols/validate`, `/jev/sessions` CRUD + `/ticks` (`?tail=N` for the latest N) + `/calibration` + `/stop` + `/flatten`, and `WS /ws/jev/{id}` |
| (none) | `portfolio_performance.py` | `GET /portfolio/{id}/performance?mode=auto\|actual\|current&range=1m..5y&benchmark=SPY` — time-weighted return vs a benchmark, risk stats, trailing returns, per-holding contribution (see *Portfolio performance* below) |
| (none) | `portfolio_risk.py` | `GET /portfolio/{id}/risk?lookback=3m\|6m\|1y\|3y&benchmark=SPY` — risk of today's holdings: volatility, beta, 1-day VaR/CVaR, drawdown, concentration, risk share per holding, correlation matrix + clusters, stress replays, Monte Carlo (see *Portfolio risk* below) |
| (none) | `portfolio_rebalance.py` | `GET/PUT /portfolio/{id}/targets` (target weights + tolerance bands, must sum to 100%) and `GET /portfolio/{id}/rebalance?mode=bands\|full\|contribute\|withdraw&amount=&whole_shares=` (drift + trade plan); see *Rebalancing* below |
| (none) | `portfolio_ledger.py` | Transaction ledger: `/portfolio/{id}/transactions` (list, add, `PATCH`/`DELETE /{tx_id}`, `POST /import` with `dry_run`), `/portfolio/{id}/ledger` (summary `GET`, `POST /bootstrap`, `PUT /settings`, `DELETE`); see *Transaction ledger* below |
| (none) | `mcp_tokens.py` | Personal access tokens for the MCP server: `GET/POST /mcp-tokens`, `DELETE /mcp-tokens/{id}` (revoke). The token is returned once; only its SHA-256 is stored |
| `/mcp` | `app/mcp_server.py` | The MCP server itself (not a FastAPI router; see *MCP server* below) |
| (none) | `alerts.py` | Alert rules CRUD (`/alerts/rules`), dry-run `POST /alerts/rules/{id}/check`, inbox (`GET /alerts/events`, `GET /alerts/unread-count`, `POST /alerts/events/read`); see *Alerts* below |
| (none) | `tickers.py` | Batch ticker metadata — `GET /tickers/metadata?symbols=AAPL,MSFT`. Returns company name, sector, logo, exchange, market cap, etc. from Finnhub with a DB cache (`ticker_metadata` table, TTL-based). Up to 50 symbols per request. |

CORS is restricted to `settings.frontend_url`.

**Markov regime analysis:** `services/markov_service.py` fits a 3-state (Bull/Sideways/Bear) Gaussian HMM on 2 years of daily returns via `hmmlearn` (optional dependency — install with `pip install -e ".[markov-hmm]"`). Returns current regime, directional signal (`bull_prob − bear_prob`, range −1 to +1), walk-forward Sharpe, max drawdown, and the 3×3 transition probability matrix. Results are cached in-process for 1 hour. The endpoint is authenticated (`Depends(get_current_user)`).

**JEV Lab (`backend/jev_loop/` + `services/jev_*.py`):** The one exception to "no order execution", fenced hard. A market-making loop (spec: `docs/superpowers/specs/2026-09-26-jev-lab-design.md`). `jev_loop/` is a pure package (no I/O): state snapshot, the seven-question Jev battery + arithmetic guard (`split.py`), policy, strategy thresholds, Avellaneda-Stoikov pricing, nine hard risk limits, fallback ladder, order planner, calibration. `services/jev_loop_runner.py` runs the tick loop; `jev_session_manager.py` owns tasks (max 2 running, 1 paper session per symbol), the DB sink + WebSocket broadcast, startup recovery (running → `interrupted`, paper orders cancelled; never blocks boot) and nightly tick retention (14 days). `jev_client.py` resolves the decider: valid `typesafe` key → valid `ai_gateway` key (Vercel AI Gateway, `typesafe-ai/jev`) → labelled mock. Jev's upstream hosts (TypeSafe, DigitalOcean) rate-limit per model with no rate-limit headers, so each Jev call is a single request (a 429 is never retried inside a tick) and `jev_loop/pacing.py` spaces calls (`jev_interval_s`, default 6 s; doubled on 429, eased back on success); ticks in between decide on the last answer while it is under `jev_answer_ttl_s` (12 s), and a directional trade fires only on a fresh answer. The gateway request prefers `typesafe-ai` via `providerOptions`. Stale data means the age of our fetch at decision time (`max_stale_data_age_s`, 5 s); the venue book's last-change age is reported as `book_age_s` and never vetoed. A paper session whose gateway refuses billing fails immediately instead of running on the mock. `alpaca_paper_client.py` is paper-only by construction (no live URL, no base-URL parameter); all Alpaca calls share one ~180/min limiter per key. Modes: `shadow` (default; real data, never orders; forced for any mock decider) and `paper` (admin-only, needs a real Jev key). Session risk limits may only be lowered (`validate_limit_overrides`). Keys: `alpaca_paper` is stored as encrypted JSON `{"key_id","secret"}`; non-`PK` (live) key IDs are rejected.

**Portfolio performance (`services/price_history_service.py`, `services/performance_calc.py`, `routers/portfolio_performance.py`):** `price_bars(symbol, date, close, fetched_at)` stores 5 years of yfinance *adjusted* daily closes per symbol. A refresh always replaces a symbol's whole window (adjusted closes are revised after every dividend/split, so stitching fetches would create fake jumps). Rows are fresh for 12 h; downloads run two at a time with retry back-off, and a symbol that still fails is not retried for 5 min (Yahoo rate-limits bursts with `YFRateLimitError`). A nightly job (`price_history_refresh`, weekdays 22:30 UTC) force-refreshes every ticker in each portfolio's latest snapshot plus SPY/QQQ. `performance_calc.py` is pure: holdings-based TWR, where each day's return uses the holdings at the previous close, so a new snapshot is a cash flow, not a gain. The benchmark's calendar is the master calendar (crypto weekend moves fold into Monday), the forward fill is capped at 7 days, and each symbol gets one constant FX factor (today's rate), so returns are local-currency returns. Modes: `actual` follows the snapshot timeline (each upload applies from its UTC upload date; the last upload of a day wins); `current` is a what-if holding today's shares over the whole range; `auto` picks `actual` once there are ≥ 30 days of upload history. Unpriced holdings and a missing benchmark are reported in `warnings`, never silently zeroed. Frontend: **Performance** tab (`components/portfolio/PerformancePanel.tsx`, figures in `lib/performanceChart.ts`, types/helpers in `lib/performance.ts`).

**Portfolio risk (`services/risk_calc.py`, `routers/portfolio_risk.py`):** Describes the portfolio *as held today*: current value weights (latest snapshot × latest stored close × FX factor) applied to each holding's daily returns over the lookback, on the benchmark's calendar. Holdings with real prices on fewer than 80% of the lookback's trading days (or fewer than 20), or no price, are left out (days before a listing would otherwise count as flat) and named in `warnings` (with the share of value covered). `risk_calc.py` is pure (numpy): annualised volatility, beta/correlation vs the benchmark, 1-day historical VaR/CVaR at 95% (also in money), max drawdown of today's weights, concentration (HHI, effective holdings, top-1/top-5 weight), each holding's share of portfolio variance (`w_i·(Σw)_i / wᵀΣw`), a correlation matrix (largest 20 holdings), clusters of holdings with pairwise correlation ≥ 0.8 (union-find), and a 1-year block-bootstrap Monte Carlo (2,000 paths, 5-day blocks, fixed seed so numbers don't jump between loads). Stress scenarios (`STRESS_SCENARIOS`: GFC, COVID, 2022 rates, Aug 2024 carry unwind, 2025 tariffs) replay each holding's real move when the 5-year store covers the window; otherwise they use beta-vs-SPY × the S&P 500 move (stored SPY prices, or the hard-coded index-level move for windows older than the store), floored at −100% per holding. Every row says how it was built. Frontend: **Risk** tab (`components/portfolio/PortfolioRiskPanel.tsx`, figures in `lib/riskChart.ts`, types/helpers in `lib/risk.ts`). Shared helpers for both price-history endpoints live in `services/portfolio_pricing.py`.

**Rebalancing (`models/portfolio_target.py`, `services/rebalance_calc.py`, `routers/portfolio_rebalance.py`):** `portfolio_targets(portfolio_id, ticker, weight, band)` holds per-ticker target weights (fractions, summing to 1 ± 0.001, enforced on PUT, which replaces the whole set) and absolute tolerance bands (default ±5pp). A held ticker without a target counts as 0% (a rebalance sells it, with a warning). A target that isn't held yet is a buy. Prices are the latest stored close × today's FX factor; unpriced targets are dropped and the rest re-normalised. `rebalance_calc.py` is pure, with four modes:
- `full`: every position to target, plus optional new cash.
- `bands`: only positions outside their band go back to target; in-band positions fund the shortfall or absorb the surplus in proportion to their distance from target.
- `contribute`: buy-only, split in proportion to each underweight's shortfall; once every shortfall is filled, the excess follows the targets.
- `withdraw`: sell-only, mirroring contribute.

`whole_shares` rounds stocks (not crypto) with buys down and sells up, so the plan always stays funded. Trades under max($1, 0.05% of value) are dropped. A cash leftover within a cent per trade is reported as 0 (cent-rounding noise). Sells are listed first. The output is a plan only; AgentFloor never trades. Frontend: **Rebalance** tab (`components/portfolio/RebalancePanel.tsx`, helpers in `lib/rebalance.ts`):
- a drift chart (current weight vs target ± band);
- a targets editor with "Current weights" / "Equal weight" presets, a sum check and "Scale to 100%";
- mode pills;
- a trades table that flags sells which also carry a trim signal (from the Holdings tab's trim-signals query);
- CSV download.

**Transaction ledger (`models/portfolio_transaction.py`, `services/ledger_calc.py`, `services/ledger_service.py`, `routers/portfolio_ledger.py`):** `portfolio_transactions` rows (`trade_date`, `type` BUY/SELL/SPLIT/DIVIDEND/INTEREST/FEE/DEPOSIT/WITHDRAWAL, `symbol`, `quantity`, `price`, `amount`, `fees`, `account`, `currency`, `source` manual/csv/opening, and `seq` to order same-day rows).
- **Opting in:** a portfolio becomes **ledger-backed** (`portfolios.holdings_source = "ledger"`) once it has transactions. `ledger_service.sync_holdings` then re-derives the holdings after every change into one reused snapshot (`broker="ledger"`), so every existing feature keeps reading snapshots unchanged.
- **Lock:** while ledger-backed, `ensure_not_ledger_backed` makes CSV holdings uploads and inline holding add/edit/delete return 409. The Holdings tab turns read-only with a banner, and its Import button opens Transactions. Deleting every transaction (`DELETE /ledger`) returns the portfolio to snapshot-backed with the last derived holdings.
- **Maths:** `ledger_calc.py` is pure. It replays transactions into lots per (account, symbol) with FIFO/HIFO/average cost (`portfolios.cost_basis_method`; average pools the basis but takes quantities FIFO so holding periods stay meaningful). Buy fees go into the cost basis and sale fees reduce proceeds. Splits scale lots. A sale beyond what is held only realises the held quantity and warns (no shorts). Realised gains are short or long term (held more than 365 days). It also tracks income (dividends, interest), fees, cash and net contributions per account (cash is only meaningful once deposits are recorded: `cash_tracked`). Totals are grouped by currency, not converted.
- **Getting data in:** bootstrap creates one opening BUY per current holding at its average cost. CSV import runs in the browser (`lib/ledger.ts`: parse, guess columns from broker headers, normalise broker wording such as "YOU BOUGHT" or "Qualified Dividend", take absolute values, and derive a missing price from amount ÷ quantity). The server validates every row (dry run), then inserts all of them or none.
- **Performance:** for a ledger-backed portfolio, the actual-holdings timeline comes from `holdings_timeline` (real trade dates). The report adds `mwr_period` / `mwr_annualised`, an IRR via `performance_calc.xirr` (bisection), where the opening value, buys and sales at trade price ± fees, and the ending value are the flows. Dividends are already in the adjusted prices, so they are not counted again.
- **Frontend:** **Transactions** tab (`components/portfolio/TransactionsPanel.tsx`, `ImportTransactions.tsx`):
  - an empty state with start from holdings, import CSV and add;
  - summary tiles (realised gains this year and all time with the short/long split, dividends and interest, fees and cash);
  - cost-basis pills;
  - an add form whose fields follow the type;
  - the transactions table;
  - open lots per position;
  - realised gains by year and term;
  - "Stop using the ledger".

**MCP server (`app/mcp_server.py`, `models/mcp_token.py`, `routers/mcp_tokens.py`):** AgentFloor is exposed to MCP clients (Claude Code/Desktop, Cursor, …) at `/mcp` (behind nginx `https://<host>/api/mcp`).
- **Transport:** FastMCP from the `mcp` SDK in stateless Streamable HTTP mode with JSON responses (no SSE, so nginx needs no change). `mcp` arrives transitively via `chainlit` in `uv.lock`: it could not be declared directly because `uv lock` currently fails for the Python 3.14/Windows split (tradingagents 0.7 is unavailable there). The app still boots without it, and then `/mcp` answers 503.
- **Routing:** `McpDispatch` (ASGI middleware added in `main.py`) hands exactly `/mcp` and `/mcp/` to the MCP app and everything else to FastAPI. A `Mount("/mcp")` would only match `/mcp/...`. The session manager runs inside the FastAPI lifespan.
- **Auth:** `PatVerifier` (FastMCP `TokenVerifier`) resolves `Authorization: Bearer af_...` to the user via the SHA-256 lookup. It rejects revoked or expired tokens and records `last_used_at` at most every 5 min. Tools read the caller from `get_access_token()`, and every query is scoped to that user.
- **Scopes and tools:**
  - `read`: `list_portfolios`, `get_holdings`, `get_performance`, `get_risk`, `get_rebalance_plan`, `get_regime`, `list_runs`, `get_run_report`, `get_latest_insight`, `list_alerts`.
  - `research` (opt-in when creating the token) adds `start_analysis` (creates a Run labelled "via MCP" with the user's default LLM) and `generate_portfolio_insight`.
  - No tool places orders and JEV Lab is not exposed.
- **DNS-rebinding:** host checking is disabled on purpose. Every request needs a bearer token that a rebinding page cannot attach, and the check would reject proxied hosts.
- **Tests:** `tests/test_mcp_server.py` drives a fresh `build_server()` with the official MCP client over an in-process ASGI transport. The ASGI transport doesn't run the lifespan, so each test runs its own session manager.
- **Frontend:** the Settings **MCP access** section (`components/settings/McpAccessSection.tsx`, helpers in `lib/mcp.ts`) creates a token (name, expiry, research opt-in), shows it once with copy-ready config for Claude Code, Cursor and Claude Desktop (via `mcp-remote`), and lists and revokes tokens.

**Alerts (`models/alert.py`, `services/alert_rules.py`, `services/alert_engine.py`, `routers/alerts.py`):** Per-user `AlertRule` rows (`kind`, `params` JSONB, `channels`, `cooldown_hours`, `enabled`, engine `state`) and `AlertEvent` rows (the in-app inbox, with a `delivery` outcome per channel). Kinds in `alert_rules.KINDS`:
- **Level rules** fire when the condition *becomes* true and re-arm once it is false. The first check counts as a transition, so a rule created while already true fires once. Kinds: `price_above`, `price_below`, `daily_move` (re-arms each trading session, keyed by the quote's previous close, not the UTC date), `ma_cross` (50/200-day, on stored daily closes), `portfolio_drawdown` (Performance report), and `position_weight` (fires per newly oversized holding).
- **Change rules** record a baseline on the first check, then fire on change: `regime_change` (Markov, optionally into a given regime) and `verdict_change` (a newer completed run with a different verdict).

`alert_rules.evaluate` is pure. The engine's `MarketData` fetches observations with a per-pass cache, so N rules on one ticker cost one fetch, and tests subclass it. The scheduler job `alert_evaluation` (every 15 min) runs `evaluate_all_alerts`: evaluate, persist state, then deliver. A firing inside the cooldown is swallowed and consumes the transition. A pass that is still running makes the next one skip (in-process lock, single worker), so overlapping passes can't double-fire. Inbox items are marked read only by an explicit action (Mark read, or opening their link). Channels: `inbox` (always), `email` (the user's address; SMTP stub when unconfigured), `webhook` (the rule's portfolio's `PortfolioDeliverySettings`, json/slack/telegram). Webhook needs `portfolio_id`; ticker rules may set one for that. "Check now" (`check_rule`) is a dry run: no state change, nothing fires. 100 rules per user. Frontend: `/alerts` page (`components/alerts/`), an unread badge on the **Alerts** nav item (polled every 60 s) and a dot on the mobile menu button, plus alert shortcuts in `TickerDrawer` (`/alerts?ticker=X&kind=Y` prefills the form).

**Auth flow:** `POST /auth/register` — first user gets `admin` role automatically. Subsequent registrations require a valid invite token. `POST /auth/login` returns a JWT. All other routes use `get_current_user` (dependency in `app/dependencies.py`) which validates the Bearer token and loads the `User` row. `POST /auth/invite` generates a signed invite token and emails the link; when SMTP is not configured the invite URL is returned in the response body (`invite_url` field) so the admin can copy-paste it.

**Run lifecycle:**
1. `POST /runs` creates a `Run` row and immediately calls `start_run()` from `job_manager.py`.
2. `job_manager.py` wraps `execute_run()` in an `asyncio.Task` and stores it by `run_id`.
3. `trading_agent_runner.py` runs `TradingAgentsGraph.propagate()` in a thread (`asyncio.to_thread`) because TradingAgents is synchronous. A `_SyncEmitter(BaseCallbackHandler)` puts events into a `SyncQueue`; a drain coroutine transfers them to an `asyncio.Queue`; a process coroutine persists `AgentEvent` rows and broadcasts over WebSocket. `propagate()` returns `(final_state, recommendation)` — the recommendation's `.signal`/`.rationale`/`.entry_reference_price`/`.stop_loss`/`.target_price` fields are used directly to populate the `Report`.
4. `DELETE /runs/{run_id}` calls `abort_run()` which cancels the asyncio task, triggering `CancelledError` in the runner, which sets status to `aborted`.
5. `GET /runs/{run_id}/report` returns the `Report` row created at completion.
6. On completion, `outcome_service.py` lazily fetches closing prices from Finnhub (`/stock/candle`) at +7d/+14d/+30d/+90d and persists a `RunOutcome` row.

**Elliott Wave analysis (`backend/elliott_wave/`):** Self-contained package vendored into the repo. Entry point is `services/wave_service.py` which wraps the package in async helpers. Architecture: `AnalysisOrchestrator` (top-level) → `SwingDetector` (ZigZag pivots) + `ElliottEngine` (wave labelling) + `FibonacciEngine` (retracement/extension levels) + `SignalEngine` (trade region scoring) + `ChartPayloadService` (Plotly-ready JSON). Results are cached in-process for 4 hours keyed by `ticker:period:interval:profile`. Four analysis profiles: `full_confluence`, `elliott_focused`, `fib_only`, `swing_only`. The `GET /wave/{ticker}` endpoint returns a compact summary (scenario, direction, trade zone, confidence) suitable for badges; `POST /wave/{ticker}/analyze` returns the full chart payload for the `WavePanel` Plotly chart. The portfolio batch endpoint (`GET /portfolio/{id}/wave`) runs summaries concurrently for all holdings via `asyncio.gather` with a semaphore(5) cap.

**Watchlist & Scheduler:** `watchlist.py` router manages per-user watchlists (one per user, auto-created on first access). Each `WatchlistItem` stores ticker, LLM config, and an optional cron expression. `services/scheduler.py` wraps APScheduler 4.x `AsyncScheduler`. On startup it calls `start_in_background()` (required — `__aenter__` alone leaves the scheduler in `RunState.stopped`) then `_reload_jobs()` to register all enabled items. After every watchlist mutation the router calls `reload_jobs()` so changes take effect without restart. Additionally, a system-level daily job (`daily_portfolio_insights`, weekdays 09:15 UTC) calls `_fire_daily_portfolio_insights()`, which picks the first configured LLM provider key and generates a `PortfolioInsight` for every portfolio that has holdings and no insight in the last 12 hours.

**WebSocket:** `ws_manager` (singleton in `websocket_manager.py`) maintains `dict[run_id, list[WebSocket]]`. The WS endpoint at `/ws/runs/{run_id}` loops on `receive_text()` to keep the connection alive; clients send `"ping"` every 30 s.

**Encryption:** API keys are stored encrypted. `services/encryption.py` derives a `Fernet` key from the 64-hex-char `ENCRYPTION_KEY` setting.

**Config:** All settings are in `app/config.py` via pydantic-settings. Env var names: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FRONTEND_URL`. For local inference: `OLLAMA_HOST` (default `http://localhost:11434`) and `VLLM_BASE_URL` (default `http://localhost:8080`) are read via `getattr(settings, ..., default)` — add them to `config.py` if you need to override the defaults.

**TradingAgents version:** `tradingagents>=0.7.0,<0.8.0` (PyPI, Mai0313 fork). The `backend/patches/` install-time monkey-patch pipeline was removed when upgrading from 0.3.2; the technical analyst is now folded into the upstream `market` analyst. Legacy `"technical"` analyst selections are silently normalised to `"market"` by `app/utils/tradingagents_analysts.py`. `propagate()` now returns `(state, recommendation)` — a structured `TradeRecommendation` object with `.signal` (BUY/SELL/HOLD), `.rationale`, `.entry_reference_price`, `.stop_loss`, `.target_price` — replacing the free-text signal string. `_parse_verdict` and `_extract_trader_decision` in `trading_agent_runner.py` consume these structured fields directly.

**TradingAgents runtime patches (`services/tradingagents_grounding.py`):** Two runtime patches applied at the start of each `execute_run` call (idempotent, module-level flags). Neither modifies site-packages. (1) `apply_analyst_specific_grounding_patch()` — tightens the grounding check so an analyst section is only marked as evidence-based when the ToolMessage belongs to *that analyst's* tool set, preventing cross-analyst contamination. (2) `apply_reasoning_effort_patch()` — patches `tradingagents.llm._apply_reasoning` to skip the `reasoning_effort` kwarg when `OPENAI_BASE_URL` points to a non-native OpenAI endpoint (Groq, IONOS); both providers use an OpenAI-compatible API but reject this parameter with HTTP 400.

**Tests:** All tests share one event loop (`asyncio_default_test_loop_scope = "session"` in pyproject.toml). The `clean_db` session-scoped autouse fixture in `conftest.py` TRUNCATEs all tables before each test session: `users, runs, agent_events, reports, api_keys, run_outcomes, watchlists, watchlist_items, portfolios, portfolio_snapshots, portfolio_holdings, …, jev_sessions, jev_ticks, price_bars, alert_rules, alert_events, portfolio_targets, mcp_tokens, portfolio_transactions` (see `conftest.py` for the full list).

### Frontend (`frontend/`)

**Theming:** `next-themes` with a `ThemeToggle` button in the top nav. Semantic CSS tokens defined in `app/globals.css` via Tailwind v4 `@theme` blocks (`--color-background`, `--color-foreground`, etc.). All components use token-based classes (`bg-background`, `text-foreground`) so light/dark switch applies globally without per-component logic. The legacy `tailwind.config.ts` content array pattern is replaced by the PostCSS plugin (`@tailwindcss/postcss`).

**Auth:** NextAuth v4 with `CredentialsProvider` (calls `POST /auth/login` on the backend) and optional `GoogleProvider`. Session strategy is JWT with `maxAge: 24h` (matches backend JWT TTL — prevents stale sessions from causing infinite loading). `middleware.ts` protects all routes except `/login`, `/register`, `/api/auth/**`.

**API client:** `lib/api.ts` exports typed async functions. All calls go through `fetchWithAuth`, which reads the session token from NextAuth and sets `Authorization: Bearer <token>`; on a 401 response it calls `signOut({ callbackUrl: '/login' })` so expired sessions never leave the user on an infinite loading screen. `NEXT_PUBLIC_API_URL` points to the backend (defaults to `http://localhost:8000`).

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
- `/portfolio` — portfolio manager with primary tabs **Holdings**, **Performance** (growth-of-100 vs a benchmark, drawdown, trailing returns, contribution; Auto/Actual/What-if holdings and 1M–5Y ranges), **Risk** (VaR headline, risk vs value share, correlation heatmap and clusters, stress scenarios, 1-year Monte Carlo fan), **Rebalance** (targets, drift and a trade plan), **Transactions** (the transaction ledger: trades, income, lots, realised gains, CSV import), **AI Insights**, **Earnings**, **News**, plus Chat and Thesis in the overflow menu. **Holdings** (CSV upload, live prices via Finnhub, unrealized P&L, inline row editing, CSV export; stats bar with best/worst performer and stale count; per-row "Watch" button to add to watchlist; expandable ▸ fundamentals strip per holding), **AI Insights** (generate / view AI-powered portfolio briefings — health score, action items, risk alerts, sector exposure), **Earnings** (upcoming earnings calendar for portfolio tickers, 60-day window), and **News** (merged company news feed). Multiple portfolios per user; each portfolio holds versioned snapshots.
- `/alerts` — alert inbox (unread highlighted, mark read, delivery problems shown per event) and rules (create with a live preview sentence, enable/disable, delete, Check now). `?ticker=&kind=` prefills the form.
- `/settings` — MCP access tokens for every user (create, revoke, client config snippets); API key management (Finnhub for portfolio prices + outcome tracking; LLM providers including IONOS; JEV Lab keys: Alpaca paper Key ID + Secret, Vercel AI Gateway, TypeSafe) + team admin (admin-only). Invite URL is shown inline when SMTP is not configured.
- `/jev` — JEV Lab (nav link only when `enable_jev_loop` is on): split explainer, start form (symbol check, shadow/paper, duration, threshold/limit overrides), session list
- `/jev/[id]` — live session: price/action chart, latest Jev battery vs thresholds, tick log, position vs limits, Stop / Flatten, calibration tab. Streams via `useJevStream` (`lib/jev/`)
- `/wave/[ticker]` — Elliott Wave + Fibonacci analysis page for a single ticker. Renders the `WavePanel` Plotly chart, `WaveConfirmation` badge, scenario/trade-region panels, and a projection overlay.

**Export (`lib/export/`):** Three client-side utilities used by `DownloadMenu`:
- `buildMarkdown(run, report)` — assembles a `.md` string covering all report fields (verdict, analyst reports, debate, plan, final decision). Missing fields are silently omitted.
- `parseMdForPdf(text)` — line-by-line Markdown → `MdSegment[]` (h1/h2/h3/bullet/paragraph/blank). Used by `ReportPdf.tsx` to render text inside `@react-pdf/renderer` (which does not accept HTML).
- `ReportDocument` — `@react-pdf/renderer` Document component. Cover page + one section per report field, each starting a new page via `<View break>`. Shared fixed header (AgentFloor | TICKER — date) on every page. Dynamically imported in `DownloadMenu` so the ~400 KB bundle is not loaded until first PDF click.

**Data fetching:** TanStack Query v5 (`useQuery` / `useMutation`). `QueryClient` and `SessionProvider` are set up in `app/providers.tsx`, which wraps `app/layout.tsx`.

**Components (`components/runs/`):** `TraderDecision`, `AnalystReports`, `BullBearDebate`, `DownloadMenu` (JSON/Markdown/PDF dropdown), `ComparisonPanel` (side-by-side run columns with agreement badge), `OutcomeCard` (price grid at +7/14/30/90d, sourced from Finnhub), `PipelinePanel`, `AgentFeed`, `AgentSidebar`, `RunTable` (accepts optional `selectedIds`/`onSelectionChange` for checkbox multi-select; caps at 2 with FIFO replacement; only completed runs are selectable), `RunFilters`, `RunForm` (default provider: `openai`), `StatsBar`, `MarkovConfirmation` (shown on the holdings row — compares AI verdict with Markov regime and renders an agreement/conflict/neutral badge; neutral when verdict is hold or regime is Sideways), `WaveConfirmation` (compact Elliott/Fib badge shown next to ticker — calls `GET /wave/{ticker}` and renders scenario + trade zone).

**Components (`components/jev/`):** `NewSessionForm`, `SessionTable`, `PriceActionChart` (inline SVG), `BatteryPanel`, `RiskPanel`, `TickFeed`, `CalibrationPanel`, `SplitExplainer`, `JevBadges`, `JevDisabled`. Types in `lib/jev/types.ts`; API functions live in `lib/api.ts` with the rest.

**Components (`components/wave/`):** `WavePanel` (Plotly chart with OHLCV, swing pivots, wave labels, Fibonacci levels, projection overlay; profile selector), `OverviewBanner` (top-scenario + direction summary), `ScenarioPanel` (ranked scenario list), `TradeRegionsPanel` (entry zones), `ToolOutcomesPanel`, `WaveBadge` (inline pill for use in tables), `WaveConfirmation`, `AnalysisChart`.

**Components (`components/portfolio/`):** `PortfolioSwitcher` (dropdown with create/delete), `PortfolioHeader` (totals bar with upload/export buttons), `UploadDrawer` (drag-drop CSV zone), `HoldingsTable` (inline-editable table — click Edit to modify ticker/shares/avg cost in place, ✕ to delete a row, "+ Add row" to insert a new holding; current price/market value/P&L are read-only; filter bar with search input, signal dropdown, PEG dropdown (undervalued/fair/overvalued/no data), and Regime pill-toggle filter (Bull/Sideways/Bear); per-row "Watch" inline button adds ticker to watchlist with provider/model/depth picker; per-row regime badge shows current regime, signal, and Sharpe — only rendered when regime data is present; ▸ expand toggle (inline with ticker name) shows a fundamentals strip and, when regime data exists, a collapsible 3×3 Markov transition matrix; fundamentals are passed from parent via `fundamentals?: Record<string, FundamentalsData>`; regime data via `regime?: Record<string, RegimeData>`), `InsightsDashboard` (AI insights tab — sidebar history list, generate form with provider/model picker, SVG health-score ring, action item cards, risk alert cards, CSS-bar sector chart, strengths/weaknesses panels; auto-polls every 2 s while an insight is `pending`/`running`), `PortfolioStatsBar` (summary bar above holdings — best/worst performer by unrealized P&L %, buy/sell signal counts, undervalued by PEG count, regime distribution (Bull/Sideways/Bear counts) and average Markov signal across holdings, stale/unanalyzed count, "Analyze All Stale" shortcut button), `EarningsPanel` (Earnings tab — table of upcoming earnings for portfolio tickers via `GET /portfolio/{id}/earnings`; stale tickers highlighted yellow; EPS beat/miss colored green/red; days-away urgency coloring; queries cached 30 min frontend-side), `NewsPanel` (News tab — merged company news for all holdings via `GET /portfolio/{id}/news`; per-ticker color badges, thumbnails, source, relative timestamps; queries cached 15 min frontend-side). The `price_unavailable_reason` field is `"no_finnhub_key"` when no Finnhub key is stored.

**Portfolio data model:** `Portfolio` → `PortfolioSnapshot` → `PortfolioHolding` (cascade delete). Each upload creates a new snapshot. Holding-level endpoints (`POST/PATCH/DELETE /portfolio/{id}/holdings/{holding_id}`) mutate the latest snapshot and keep `row_count` in sync. Prices are fetched concurrently via `asyncio.gather` and cached in-process for 1 hour.

**Portfolio Insights:** `Portfolio` also has a one-to-many `insights` relationship to `PortfolioInsight` (cascade delete). Each `PortfolioInsight` row has `status` (`pending`→`running`→`completed`/`failed`), `trigger` (`manual`/`scheduled`), LLM provider/model, and JSONB output fields: `health_score` (1–10 int), `overall_stance` (`bullish`/`bearish`/`neutral`/`mixed`), `summary`, `action_items`, `risk_alerts`, `sector_analysis`, `strengths`, `weaknesses`, and `holdings_snapshot` (prices/P&L captured at generation time). The `portfolio_insight_runner.py` service: fetches live prices (reuses Finnhub cache), fetches sector data from Finnhub `/stock/profile2` (24 h in-process cache), collects last run verdicts from the DB, builds a structured JSON prompt, calls the provider API directly via httpx (OpenAI → `api.openai.com`; Anthropic → `api.anthropic.com`; Google → `generativelanguage.googleapis.com`; Ollama/vLLM → local base URL), and parses/persists the result. Before the LLM call it computes the 1-year Performance and Risk reports in their own DB session (`_measured_metrics` → `services/insight_metrics.py`) and adds a "MEASURED PERFORMANCE & RISK" block that the model is told to quote and never contradict (returns vs benchmark, contributors, volatility, beta, VaR, risk outliers, correlated clusters, worst stress replay). The same summary is stored in `holdings_snapshot.measured`; if it can't be computed the brief is generated without it. The route and runner share `services/portfolio_performance_service.py` / `portfolio_risk_service.py`, and the routers are thin wrappers that do validation and ownership checks. Concurrency guard: only one insight per portfolio can be `pending` or `running` at a time (returns 409 if attempted). Endpoints: `POST /portfolio/{id}/insights/generate` (202), `GET /portfolio/{id}/insights/latest`, `GET /portfolio/{id}/insights`, `GET /portfolio/{id}/insights/{insight_id}`.

**Portfolio supplementary endpoints (all on `/portfolio/{portfolio_id}/`):**
- `POST /runs/batch` — queues analysis `Run` rows for holdings whose last analysis is older than `staleness_days` (default 7) or never analyzed. Accepts `llm_provider`, `llm_model`, `depth`. Returns `{ queued: [...tickers], skipped: [...tickers], message }`.
- `GET /earnings?days_ahead=30` — fetches upcoming earnings from Finnhub `/calendar/earnings` for all holding tickers concurrently; returns events sorted by date. In-process cache: 6 hours per ticker.
- `GET /fundamentals` — fetches key metrics from Finnhub `/stock/metric?metric=all` for all holding tickers concurrently; returns `{ ticker: { pe_ratio, beta, week52_high, week52_low, dividend_yield, eps_ttm, market_cap } }`. In-process cache: 6 hours per ticker.
- `GET /news?days=7` — fetches company news from Finnhub `/company-news` for all holding tickers concurrently; merges and sorts by `datetime` descending; limited to 40 articles. In-process cache: 1 hour per ticker.

All four supplementary endpoints require a Finnhub key. They return empty results gracefully if no key is configured (rather than erroring).

### Deployment

`docker-compose.prod.yml` runs four services: `db` (postgres:16), `backend`, `frontend`, `nginx`. `docker-compose.dev.yml` builds the app locally and also includes Adminer. The backend waits for the `db` healthcheck before starting. Nginx reverse-proxies `/api/` → backend, `/ws/` → backend (with WebSocket upgrade headers), and everything else → frontend. TLS is handled by `docker-compose.traefik.yml`; the bare prod stack listens on HTTP port 80.
