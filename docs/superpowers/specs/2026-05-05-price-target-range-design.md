# Price Target Range Feature Design

**Date:** 2026-05-05  
**App:** AgentFloor (trading-command-center)  
**Status:** Approved

---

## Overview

Surface the entry price, stop-loss, and price target for each research run alongside the existing verdict — both on the run results page and in the run history table.

---

## Background

The `Report` database model already has three columns for price levels:
- `suggested_entry` — intended entry price
- `suggested_stop` — stop-loss price
- `suggested_target` — price target

These columns have always been `None` (never populated) and are never displayed in the UI. The `TraderDecision` component currently renders only the verdict badge and the free-form `trader_decision` LLM text.

---

## Goals

1. Populate `suggested_entry`, `suggested_stop`, `suggested_target` automatically at run completion.
2. Display all three values on the run results page (`/runs/[id]`) alongside the verdict.
3. Display a compact summary in the run history table (`/runs`) alongside the verdict column.

---

## Non-Goals

- Manual entry of price levels by users.
- Price levels on the live monitor page (`/runs/[id]/live`).
- Historical back-filling of existing completed runs.

---

## Design

### 1. Backend — Price Extraction

**File:** `backend/app/services/trading_agent_runner.py`

Add a private helper:

```python
def _extract_prices(text: str) -> tuple[str | None, str | None, str | None]:
```

It runs case-insensitive regex patterns against the `trader_decision` text to find entry, stop-loss, and target values. Returns `(entry, stop, target)` where any unmatched field is `None`. Never raises — a failed match degrades gracefully to `None`.

Pattern groups to cover common LLM phrasings:

| Field | Patterns |
|-------|----------|
| entry | `entry[: ]+$?VALUE`, `entry price[: ]+$?VALUE`, `buy at[: ]+$?VALUE` |
| stop  | `stop[-\s]*loss[: ]+$?VALUE`, `stop[: ]+$?VALUE`, `stop at[: ]+$?VALUE` |
| target | `(price )?target[: ]+$?VALUE`, `take[-\s]*profit[: ]+$?VALUE`, `profit target[: ]+$?VALUE` |

`VALUE` matches `[\d,\.]+` (digits, commas, dots).

Called immediately before the `Report` row is written at run completion:

```python
entry, stop, target = _extract_prices(trader_decision_text)
db.add(Report(
    ...
    suggested_entry=entry,
    suggested_stop=stop,
    suggested_target=target,
    ...
))
```

**No database migration required** — columns already exist.

---

### 2. Backend — API Schema

**File:** `backend/app/schemas/run.py`

Add three optional fields to `RunResponse`:

```python
suggested_entry: str | None = None
suggested_stop: str | None = None
suggested_target: str | None = None
```

**File:** `backend/app/routers/runs.py`

Update `GET /runs` and `GET /runs/{id}` queries to eagerly load the related `Report` row. Concretely: add a `report` relationship on the `Run` ORM model (one-to-one, `uselist=False`), then use `selectinload(Run.report)` in the queries. Populate `suggested_entry/stop/target` on `RunResponse` from `run.report.suggested_entry` etc. (defaulting to `None` if no report exists). This avoids N+1 queries when loading the history list.

`GET /runs/{id}/report` already returns the full `Report` object with these fields — no change needed there.

---

### 3. Frontend — Types

**File:** `frontend/lib/types.ts`

Add to the `Run` interface:

```typescript
suggested_entry: string | null;
suggested_stop: string | null;
suggested_target: string | null;
```

The `Report` interface already has these fields.

---

### 4. Frontend — Results Page

**File:** `frontend/components/runs/TraderDecision.tsx`

Add a "Price Levels" row below the verdict badge. Layout:

```
Entry  $150.00   |   Stop  $140.00   |   Target  $175.00
```

- Labels: `text-slate-400 text-xs uppercase`
- Values: `text-slate-200 font-mono`
- Separator: `text-slate-600` vertical bar or divider
- Null value renders as `—`
- The entire row is only rendered when at least one value is non-null (no visual change for runs where extraction failed)

Data source: `report.suggested_entry / suggested_stop / suggested_target` (already on the `Report` type).

---

### 5. Frontend — History Table

**File:** `frontend/components/runs/RunTable.tsx`

Add a "Prices" column after the existing "Verdict" column.

- Header: `Prices`
- Cell content: `$150 · $140 · $175` (entry · stop · target), with a tooltip on hover reading `Entry · Stop · Target`
- If all three are null: renders `—`
- If only some are null: renders available values with `—` placeholders (e.g. `$150 · — · $175`)
- Font: `font-mono text-xs text-slate-300`

Data source: `run.suggested_entry / suggested_stop / suggested_target` (added to `Run` type in Section 3, populated via the joined query in Section 2).

---

## Error Handling

- Extraction failure (no regex match): fields stay `None`, UI renders "—". No exception, no user-visible error.
- Malformed price string (e.g. `"$1,500.00"`): regex captures the raw string including commas; displayed as-is since these are display-only strings, not numbers.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/app/services/trading_agent_runner.py` | Add `_extract_prices()`, call it before writing `Report` |
| `backend/app/schemas/run.py` | Add 3 optional fields to `RunResponse` |
| `backend/app/routers/runs.py` | LEFT JOIN with `reports` in list + detail queries |
| `frontend/lib/types.ts` | Add 3 fields to `Run` interface |
| `frontend/components/runs/TraderDecision.tsx` | Add Price Levels row |
| `frontend/components/runs/RunTable.tsx` | Add Prices column |

No database migrations. No new API endpoints. No new dependencies.
