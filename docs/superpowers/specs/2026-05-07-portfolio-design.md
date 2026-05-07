# Portfolio Import & Tracking — Design Spec

**Date:** 2026-05-07  
**Status:** Approved  
**Scope:** v1 — research-contextualized holdings view

---

## Overview

Add a `/portfolio` page that lets users import broker CSV snapshots, view current holdings enriched with live prices and AI analysis verdicts, and export an enriched CSV. The feature connects a user's real positions to the app's existing AI research outputs, answering: *"given what the AI thinks, what should I do about what I actually own?"*

This is not a full portfolio accounting system. No tax lots, no FIFO/LIFO, no dividends, no transaction history. Scope is deliberately bounded to keep the app's identity as an AI research tool.

---

## Data Model

Three new tables. All user data is scoped through `Portfolio.user_id`.

### `portfolios`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → users.id | |
| `name` | str | e.g. "Moomoo Taxable", "Fidelity IRA" |
| `created_at` | datetime | server-set |

### `portfolio_snapshots`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `portfolio_id` | UUID FK → portfolios.id | cascade delete |
| `uploaded_at` | datetime | server-set on upload |
| `broker` | str \| null | detected broker name: `"moomoo"`, `"fidelity"`, `"schwab"`, `"generic"` |
| `row_count` | int | number of holdings parsed |

### `portfolio_holdings`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `snapshot_id` | UUID FK → portfolio_snapshots.id | cascade delete |
| `ticker` | str | |
| `shares` | float | |
| `avg_cost` | float \| null | cost per share; null if broker doesn't export it |
| `currency` | str | default `"USD"` |

**Key decisions:**
- Holdings are immutable once written. Re-uploading creates a new `PortfolioSnapshot`; old snapshots are preserved.
- Deleting a portfolio cascades through snapshots → holdings.
- `avg_cost` is nullable — some brokers omit it for transferred positions.
- Duplicate tickers in one CSV (split lots): last row wins, merged to a single position.
- Cash rows (ticker starts with `$`, e.g. `$USD`) are silently skipped.

---

## Backend

### Router

`backend/app/routers/portfolio.py` — mounted at `/portfolio` in `main.py`.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/portfolio` | List user's portfolios with last snapshot date and holding count |
| `POST` | `/portfolio` | Create a named portfolio |
| `DELETE` | `/portfolio/{id}` | Delete portfolio + all snapshots + holdings |
| `POST` | `/portfolio/{id}/upload` | Upload CSV → detect broker → parse → save snapshot + holdings |
| `GET` | `/portfolio/{id}/current` | Latest snapshot holdings enriched with live price + last run verdict per ticker |
| `GET` | `/portfolio/{id}/export` | `StreamingResponse` CSV of enriched latest snapshot |
| `GET` | `/portfolio/{id}/snapshots` | List all snapshots for a portfolio |
| `DELETE` | `/portfolio/{id}/snapshots/{snap_id}` | Delete a specific snapshot |

All endpoints require authentication via `get_current_user`. Users can only access their own portfolios (enforced in each endpoint).

### Parser — `backend/app/services/portfolio_parser.py`

**Detection strategy:** Read the header row, normalize to lowercase stripped strings, match against broker fingerprints in priority order:

| Broker | Fingerprint (all must be present) |
|---|---|
| Moomoo | `"symbol"` + `"qty."` + `"avg cost"` |
| Fidelity | `"symbol"` + `"quantity"` + `"cost basis total"` |
| Schwab | `"symbol"` + `"quantity"` + `"cost basis"` (distinct from Fidelity by absence of `"cost basis total"`) |
| Generic | `"ticker"` or `"symbol"` + `"shares"` or `"quantity"` |

If no fingerprint matches: raise `422` with a human-readable message explaining the generic format.

**Output:** `list[HoldingRow]` — a plain dataclass with `ticker: str`, `shares: float`, `avg_cost: float | None`, `currency: str`.

**Parser column maps:**

- **Moomoo:** `symbol` → ticker, `qty.` → shares, `avg cost` → avg_cost (direct column)
- **Fidelity:** `symbol` → ticker, `quantity` → shares, avg_cost derived as `cost basis total / quantity` (Fidelity does not export a per-share avg cost column)
- **Schwab:** `symbol` → ticker, `quantity` → shares, avg_cost derived as `cost basis / quantity` (Schwab exports total cost basis, not per-share)
- **Generic:** first column matching `ticker`/`symbol` → ticker, first matching `shares`/`quantity` → shares, first matching `avg_cost`/`average cost`/`avg cost` → avg_cost (optional, taken as-is — expected to be per-share)

### Price Enrichment (`GET /portfolio/{id}/current`)

1. Load latest `PortfolioSnapshot` for the portfolio; if none, return `{"holdings": [], "snapshot": null}`.
2. Fetch the current user's Alpha Vantage API key from the `api_keys` table (provider = `"alpha_vantage"`). If no key is set, skip price fetching entirely — all holdings are returned with `current_price: null` and the response includes `"price_unavailable_reason": "no_av_key"` so the frontend can show a hint linking to Settings.
3. For each unique ticker, call Alpha Vantage `GLOBAL_QUOTE` endpoint using the same HTTP client pattern as `outcome_service.py`.
4. Cache results in-process (shared module-level dict keyed by ticker, with per-entry expiry timestamp) for **1 hour** to respect the free-tier 25 req/day limit. Cache is shared across users since price data is public.
5. For each holding, compute:
   - `current_price`: from AV or `null`
   - `market_value`: `shares × current_price` or `null`
   - `unrealized_pnl`: `(current_price - avg_cost) × shares` or `null`
   - `unrealized_pnl_pct`: `(current_price / avg_cost - 1) × 100` or `null`
5. Last run verdict: one SQL query — for each ticker, fetch the most recent `Run` row where `created_by = current_user.id` and `status = "completed"`, returning `verdict`, `analysis_date`, `run_id`.
6. Return combined payload per holding.

**Response schema (`GET /portfolio/{id}/current`):**

```json
{
  "snapshot": { "id": "uuid", "uploaded_at": "iso8601", "broker": "moomoo", "row_count": 8 },
  "price_unavailable_reason": null,
  "totals": { "market_value": 84320.0, "unrealized_pnl": 6140.0, "unrealized_pnl_pct": 7.9 },
  "holdings": [
    {
      "ticker": "AAPL",
      "shares": 50.0,
      "avg_cost": 162.40,
      "currency": "USD",
      "current_price": 189.20,
      "market_value": 9460.0,
      "unrealized_pnl": 1340.0,
      "unrealized_pnl_pct": 16.5,
      "last_run": { "run_id": "uuid", "verdict": "buy", "analysis_date": "2026-05-04" }
    }
  ]
}
```

`last_run` is `null` if no completed run exists for that ticker by this user. `current_price`, `market_value`, `unrealized_pnl`, `unrealized_pnl_pct` are `null` if AV data is unavailable. `totals` fields are `null` if no prices are available.

### Export (`GET /portfolio/{id}/export`)

`StreamingResponse` with `Content-Type: text/csv` and `Content-Disposition: attachment; filename="portfolio-{name}-{date}.csv"`.

Columns: `Ticker, Shares, Avg Cost, Current Price, Market Value, Unrealized P&L ($), Unrealized P&L (%), Last Analysis Verdict, Last Analysis Date`

---

## Frontend

### New page: `frontend/app/portfolio/page.tsx`

Protected by `middleware.ts` (already covers all non-auth routes). Accessible via a new **Portfolio** nav item added to the shared layout.

### Components (`frontend/components/portfolio/`)

| Component | Purpose |
|---|---|
| `PortfolioSwitcher` | Dropdown to select active portfolio; inline "+ New" button to create; delete button per portfolio |
| `UploadDrawer` | Slide-down drag-and-drop zone, triggered by "Upload snapshot" button; shows detected broker badge on file selection; confirm button submits |
| `HoldingsTable` | Main holdings grid (see columns below) |
| `PortfolioHeader` | Compact bar: portfolio switcher + inline total value + unrealized P&L + Upload/Export action buttons |

### Holdings table columns

| Column | Notes |
|---|---|
| Ticker | Purple monospace, links to last run if one exists |
| Shares | Numeric |
| Avg Cost | Greyed; `—` if null |
| Current Price | From Alpha Vantage; `—` if unavailable |
| Market Value | `—` if price unavailable |
| Unrealized P&L | `+$X (+Y%)` in green; `-$X (-Y%)` in red; `—` if no cost/price |
| Last Analysis | BUY/SELL/HOLD badge + `"Nd ago →"` link to run detail; `"Not analyzed"` if none |
| Actions | "Analyze" button → navigates to `/runs/new?ticker=TICKER` pre-filled; **Note:** `/runs/new` needs a new `ticker` query-param read on mount to pre-fill the ticker field — this is a small dependency to implement alongside the portfolio feature |

### Empty state

When portfolio has no snapshots: upload drawer is expanded by default with the supported broker badges shown. No table is rendered.

### Data fetching

TanStack Query `useQuery` for `GET /portfolio/{id}/current`. `useMutation` for upload, portfolio create/delete, snapshot delete. Follows the existing pattern in `lib/api.ts` + `fetchWithAuth`.

### Export

"Export CSV" button calls `GET /portfolio/{id}/export` with `fetchWithAuth`, triggers browser download via a blob URL — same pattern as existing export utilities.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Unrecognized CSV format | `422`: *"Could not detect broker format. Expected columns: ticker (or symbol), shares (or quantity), and optionally avg_cost."* |
| Empty CSV or header-only | `400`: *"Uploaded file contains no holdings rows."* |
| Cash rows (`$USD`, `$CASH`, etc.) | Silently skipped by parser |
| `avg_cost` missing or unparseable | Stored as `null`; P&L columns show `"—"` |
| Alpha Vantage rate limit / timeout | Holdings returned with `current_price: null`; frontend shows `"—"` gracefully |
| Portfolio has no snapshots | `GET /current` returns `{"holdings": [], "snapshot": null}`; upload drawer shown expanded |
| Duplicate ticker in CSV | Last row wins (merges split lots into one position) |

---

## Testing

`backend/tests/test_portfolio.py`:

- Portfolio CRUD (create, list, delete with cascade)
- Upload endpoint with fixture CSVs for all 4 parser paths (Moomoo, Fidelity, Schwab, generic)
- Two sequential uploads → two snapshots; `GET /current` returns latest snapshot
- Snapshot delete → rolls back to previous snapshot
- Parser unit tests: correct ticker extraction, cash-row skipping, null avg_cost, duplicate ticker merging
- Export CSV: correct headers, correct row count, numeric formatting
- Alpha Vantage calls mocked in all tests (no live network)
- Last-run verdict join: correct verdict and `run_id` returned per ticker
- Authorization: user A cannot access user B's portfolios
- No AV key set: `GET /current` returns all holdings with `current_price: null` and `price_unavailable_reason: "no_av_key"`

---

## What This Is Not

- No transaction-level import (only position snapshots)
- No realized gain/loss tracking
- No dividend tracking
- No sector/allocation charts (can be added in v2)
- No FIFO/LIFO cost basis calculation
- No multi-currency conversion
- No Robinhood parser (PDF-only, no native CSV — add only if demand is clear)
- No IBKR parser in v1 (Flex Query format is complex enough to warrant its own iteration)
