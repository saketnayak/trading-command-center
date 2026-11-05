# Handoff: 2026 feature roadmap, after 3.1 (`claude/clever-cray-8uxyls`)

**Branch:** `claude/clever-cray-8uxyls` (equal to `main` at `3119b92` plus this document)
**Roadmap:** [`docs/feature-roadmap-2026.md`](../feature-roadmap-2026.md)
**Architecture reference:** [`CLAUDE.md`](../../CLAUDE.md), which has a section for every feature below
**Status:** Phases 1–2 and roadmap 3.1 are shipped and merged. Nothing is half-built; there is no uncommitted code. Next up is **3.2 Natural-language watch rules**.

---

## What shipped (all merged to `main`)

| Roadmap | Feature | PR |
|---|---|---|
| 1.1–1.6 | Price store, Performance, Risk, Rebalance, Alerts, MCP server | saketnayak/trading-command-center#56 |
| 2.1 | Transaction ledger and tax lots | saketnayak/trading-command-center#58 |
| 2.2 | Dividend and income tracker (Income tab) | saketnayak/trading-command-center#59 |
| 2.3 | Tax tools (Tax tab: 8949 report, wash sales, harvest candidates) | saketnayak/trading-command-center#60 |
| 2.4 | Net worth page, manual items, BTC/ETH wallets; **also fixed FX** (Frankfurter 301) | saketnayak/trading-command-center#61 |
| 3.1 | Backtest Lab and model leaderboard | saketnayak/trading-command-center#62 |
| 3.1 | Opt-in learning loop and hindsight flags | saketnayak/trading-command-center#64 |

Alembic head: `x4y5z6a7b8c9` (learning loop). Chain since Phase 2: `s9t0u1v2w3x4` (ledger) → `t0u1v2w3x4y5` (dividends) → `u1v2w3x4y5z6` (net worth) → `v2w3x4y5z6a7` (backtests) → `w3x4y5z6a7b8` (stranded ledger snapshots) → `x4y5z6a7b8c9` (learning loop; first merged as a second `w3x4y5z6a7b8`, renumbered).

---

## Leftovers inside shipped features

None of these is started. Each is small enough for one PR.

| Feature | Open item | Notes |
|---|---|---|
| 1.4 Rebalance | Sector/asset-class targets; targets seeded from the investor profile; tax-aware mode | Tax-aware mode can now use 2.3's lots (`tax_calc.harvest_candidates`, wash-sale check) to prefer selling losing or long-term lots |
| 1.5 Alerts | Elliott-zone and earnings-date rule kinds | Add kinds to `alert_rules.KINDS`; `MarketData` in `alert_engine.py` fetches observations |
| 2.1 Ledger | An accounts table with types (taxable/IRA/401k); an LLM-assisted CSV column mapper; per-broker presets | Accounts today are free-text `account` strings on transactions. Account types would let 2.3 skip wash-sale and gain reporting for tax-advantaged accounts |
| 2.2 Income | Pay dates (yfinance only has ex-dates); per-account DRIP settings | |
| 2.3 Tax | Other jurisdictions; carrying disallowed wash-sale losses into the replacement lots' basis; wash sales against accounts outside AgentFloor | Basis carry-over would change `ledger_calc.replay`, so it needs care: tax report only, not holdings cost |
| 2.4 Net worth | Household-wide allocation targets; ERC-20 tokens; BTC xpubs | `wallet_service.py` |
| 3.1 Learning | Learning loop not yet exercised against a real LLM key | It ran to the OpenAI call in dev (no key) and wrote memories with the harness's `StubChatModel`. Run one real reflection with a cheap model once a key is available |
| 3.1 Backtest | `MODEL_CUTOFFS` in `backtest_calc.py` is approximate and needs periodic updating | Newer models (e.g. `gpt-5.5`, `claude-sonnet-4-6`) deliberately report *unknown* rather than borrowing an older cutoff |

---

## Remaining roadmap

### 3.2 Natural-language watch rules (next; M; builds on 1.5 Alerts)

Goal: "Tell me if any semiconductor holding goes Bear on Markov *and* drops below its 200-day."

Suggested design:
1. **Compound rules in the existing engine.** Add a `kind="compound"` (or a `conditions` list in `params`) to `services/alert_rules.py`: AND/OR of existing level conditions (`price_above/below`, `ma_cross`, `regime` state, `daily_move`, `position_weight`). Add a scope: one ticker, a portfolio's holdings, or holdings filtered by sector (Finnhub sector via `ticker_metadata`). `alert_rules.evaluate` stays pure and deterministic; fire per ticker that newly matches, re-arming like level rules.
2. **Compiler endpoint.** `POST /alerts/compile {text}` sends the sentence to the user's default LLM (`llm_selection.pick_llm_for_user`) with a JSON schema of the DSL. It returns the compiled rule plus a plain-English read-back and never saves. Validate the output with the same Pydantic models as manual rules. Show "couldn't understand X" rather than guessing.
3. **Approval UI.** On `/alerts`, a text box, then "Here's what I'll watch for" (the preview sentence the form already builds), then Save. The LLM is never in the evaluation path.
4. **Optional action.** "Re-run the analysis when it fires": on firing, create a Run (like `start_analysis` in `mcp_server.py`, label "via alert") and link it from the inbox event. Research only; never an order.
5. **Tests.** Pure evaluator tests for AND/OR and scope; compile endpoint tests with a faked LLM; an MCP tool `compile_alert` is optional.

### 3.3 "What changed" digests (M)

- SEC EDGAR is free and keyless but **requires a descriptive User-Agent with contact info** (use a configurable setting, not a personal email).
- Endpoints: `https://data.sec.gov/submissions/CIK##########.json` (filings), the CIK map `https://www.sec.gov/files/company_tickers.json`, and Form 4 XML.
- Store filings per ticker and summarise new 10-K/10-Q/8-K diffs with the LLM, with links to the filing. Feed the morning brief (`components/portfolio/MorningBriefStrip.tsx` and the insight runner).
- Check the network policy first; earlier sessions reached mempool.space, publicnode, yfinance and frankfurter.

### 3.4 ETF look-through X-ray (M; data dependency)

- Constituents come from issuer holdings files (SPDR/iShares CSVs, no stable API) or Finnhub `/etf/holdings` (paid tier). Cache them weekly.
- Output: true exposure per stock and sector, an overlap matrix, and "you hold 9.4% NVDA through 3 funds plus directly". Feed `risk_calc` concentration and the rebalance targets.

### Phase 4

- **4.1 Read-only broker sync:** SnapTrade/Plaid into the ledger (`source=broker`). Read scopes only.
- **4.2 Goals and planning:** Monte Carlo on the investor profile and Phase 1 stats.
- **4.3 Screener:** factor, regime and wave filters over `sp500_sectors`.
- **4.4 PWA and push.**

See the roadmap for detail.

---

## Existing issues noticed (not caused by this work, not fixed)

- `ruff` findings that predate these PRs:
  - `app/services/trading_agent_runner.py`: E401 (multiple imports on one line, about line 314) and F821 (`"RunVerdict"` string annotation in `_parse_verdict`);
  - `app/models/user.py`: E401 and F821 (`"InvestorProfile"`).

  CI doesn't run ruff on them.
- Nine frontend test files use `node:test`. Vitest reports them as "No test suite found", and `node --test --experimental-strip-types` fails on their extensionless imports, so **they never run**:
  - `lib/chartWindow`, `lib/currency`, `lib/export/buildMarkdown`, `lib/export/parseMdForPdf`, `lib/formatRelativeTime`, `lib/holdingLastRun`, `lib/portfolioQueries`, `lib/portfolioSelection`, `lib/portfolioCsvFromImport`.

  Converting them to vitest is a small, worthwhile PR. CI only runs `npm run lint` for the frontend.
- `npx tsc --noEmit` reports errors only in test files, because `vitest` isn't a dependency and `lib/llmConfig.test.ts:69` has a type error.
- `alembic check` reports index drift on `portfolio_insights` (generated_at, portfolio_id) and `ticker_metadata` (asset_type, expires_at): indexes that exist in the database but not in the models.
- `GET /runs/performance` and `/runs/leaderboard` cover the whole team, not the caller. This looks intentional (team app), but confirm.
- Lint warnings (`react-hooks/set-state-in-effect`) in `app/(app)/settings/page.tsx` and `app/(app)/portfolio/page.tsx`.

---

## Conventions that worked

- **Pure calc module plus thin service plus thin router.** For example `income_calc` / `dividend_service` / `portfolio_income`, and `tax_calc` / `portfolio_tax`. Unit-test the pure module with `pytestmark = pytest.mark.unit` (no DB). Integration-test the router through `tests.test_portfolio_performance._client/_token/_portfolio`.
- **Fake external data at the seam:** `price_history_service._download_closes`, `dividend_service._download_dividends`, `wallet_service.fetch_balance`, `backtest_runner._run_harness`, `learning_service._reflect`. Also set the module's `RETRY_DELAYS_S` to `(0.0,)` and clear `_recent_failures`.
- **Use unique ticker symbols per test file** (e.g. `TAXA`, `NWA`, `LRNA`). The price store is shared across the test session and caches for 12 h.
- **Docs:** each feature gets a row in CLAUDE.md's router table and its own section, plus a ✅ line in the roadmap with "still open" notes. Add every new table to the `conftest.py` truncate list.
- **Charts:** Plotly with the validated categorical pair, blue `#2a78d6`/`#3987e5` and orange `#eb6834`/`#d95926` (light/dark), via `THEMES` in `lib/wave/chartTheme.ts`. Always pair a chart with a legend and a text summary.
- **JSX whitespace gotcha:** in this build, a `{expr}` followed by text that runs to the end of the line lost its leading space ("FIFOlots", "$321.00of"). Use a template string for such sentences.
- **Every PR was verified in a real browser with Playwright** (desktop dark and light, plus iPhone 13), and several real bugs were found that way.

---

## Recreating the dev environment (cloud container)

```bash
# Postgres on 5433 (the container restarts lose it). If /var/tmp/pgdata doesn't exist yet:
PGBIN=/usr/lib/postgresql/16/bin; D=/var/tmp/pgdata
[ -d $D ] || { mkdir -p $D && chown postgres $D && su postgres -c "$PGBIN/initdb -D $D -U postgres --auth=trust"; }
rm -f $D/postmaster.pid; su postgres -c "$PGBIN/pg_ctl -D $D -o '-p 5433 -k /var/tmp' -l $D/log start"
psql -h localhost -p 5433 -U postgres -c "CREATE ROLE agentfloor LOGIN SUPERUSER PASSWORD 'agentfloor'" 2>/dev/null
psql -h localhost -p 5433 -U postgres -c "CREATE DATABASE agentfloor OWNER agentfloor" 2>/dev/null
```

```bash
cd backend
export DATABASE_URL=postgresql://agentfloor:agentfloor@localhost:5433/agentfloor \
  JWT_SECRET=ci-jwt-secret-00000000000000000000000000000000 \
  ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  FRONTEND_URL=http://localhost:3000
uv sync --group dev --extra markov-hmm
uv run alembic upgrade head
uv run python -m pytest -q                 # about 607 tests, about 2 min
nohup uv run python -m uvicorn main:app --port 8000 > /var/tmp/backend.log 2>&1 &
```

```bash
cd frontend && npm ci
NEXTAUTH_URL=http://localhost:3000 NEXTAUTH_SECRET=dev-secret-dev-secret-dev-secret-0000 \
  NEXT_PUBLIC_API_URL=http://localhost:8000 INTERNAL_API_URL=http://localhost:8000 \
  nohup npx next dev -p 3000 > /var/tmp/frontend.log 2>&1 &
npm run lint && npx vitest run && npm run build
```

- **First user:** the first user to register becomes admin: `POST /auth/register {"email","password","name"}`. Previous sessions used `demo@example.com` / `demo12345` with demo portfolios (Core, Ledger demo), but that data lived only in the old container.
- **Browser checks:** Playwright and Chromium are preinstalled (`require('playwright')`, no install step).

---

## Continuation prompt (paste into a new Claude Code session)

```text
You're continuing work on AgentFloor (repo saketnayak/trading-command-center): a FastAPI + Postgres +
Next.js research app that wraps the TradingAgents multi-agent LLM framework. It is research-only and
never places orders (the one exception is JEV Lab's Alpaca paper orders).

Start by reading, in this order:
1. docs/handoffs/2026-11-05-roadmap-phase3-handoff.md: what shipped, leftovers, existing issues,
   dev-environment setup, conventions. If it isn't on main yet, fetch branch claude/clever-cray-8uxyls.
2. CLAUDE.md: the architecture, with one section per feature.
3. docs/feature-roadmap-2026.md: the roadmap. Phases 1–2 and 3.1 are shipped (PRs #56, #58–#62, #64).

Then:
- Set up the dev environment as the handoff describes (Postgres on port 5433, backend env vars, alembic
  upgrade head) and confirm the backend suite passes and the frontend lints, tests and builds before
  changing anything.
- Build roadmap 3.2, natural-language watch rules, following the design sketch in the handoff:
  - compound AND/OR rules with holding/sector scope in the existing deterministic alert engine;
  - a POST /alerts/compile endpoint that turns a sentence into that rule with the user's default LLM
    and never saves;
  - an approve-then-save UI on /alerts;
  - an optional "re-run the analysis when it fires" action.
  The LLM must never be in the evaluation path.
- Follow the conventions in the handoff: a pure calc module with unit tests, fakes at the I/O seam,
  unique test tickers, the CLAUDE.md and roadmap updates, a Playwright browser check (desktop dark and
  light, plus mobile), and the full backend pytest, frontend lint, vitest and build before committing.
- Work on a feature branch and open a PR when done; ask before merging.
- Then continue down the roadmap (3.3 EDGAR digests, 3.4 ETF look-through, then Phase 4), or pick up
  the small leftovers listed in the handoff if I ask.
```
