---
target: Portfolio (/portfolio)
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-06-29T17-24-18Z
slug: frontend-app-app-portfolio-page-tsx
---
# Critique: Portfolio (`/portfolio`)

**Target:** `frontend/app/(app)/portfolio/page.tsx` — morning-first hero workflow on branch `feat/layout-phase-0-1a-portfolio-tabs`

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Freshness label and loading copy exist; trim-signals fetch fails silently (CORS) |
| 2 | Match System / Real World | 3 | Solid fintech framing; Markov/PEG/regime jargon assumes quant literacy |
| 3 | User Control and Freedom | 3 | Modals cancel cleanly; auto-opens upload drawer on empty snapshot feels pushy |
| 4 | Consistency and Standards | 2 | Mixed `rounded-sm` / `rounded-lg` / `rounded-md` across header, filters, stats |
| 5 | Error Prevention | 2 | Four secondary tabs buried in "More"; no guard when API panels fail to load |
| 6 | Recognition Rather Than Recall | 2 | Earnings/News/Chat/Thesis require discovering overflow menu |
| 7 | Flexibility and Efficiency | 3 | Keyboard shortcuts, batch analyze, sortable table, rich filters reward power users |
| 8 | Aesthetic and Minimalist Design | 2 | Holdings view stacks stats bar + filter row + 10-column table — high extraneous load |
| 9 | Error Recovery | 2 | Finnhub missing states are handled; trim-signals CORS leaves sell-candidates gap |
| 10 | Help and Documentation | 2 | Regime tooltips exist; no onboarding for first morning check workflow |
| **Total** | | **24/40** | **Acceptable — significant improvements needed before the morning workflow feels effortless** |

## Anti-Patterns Verdict

**LLM assessment:** This does not read as generic marketing AI slop — no gradient heroes, glass cards, or numbered section eyebrows. It reads as a credible consumer-fintech research tool with intentional slate neutrals and semantic green/red for P&L. The product-register risk is **strangeness without purpose**: uppercase 10px tracked micro-labels in `PortfolioStatsBar` and expanded regime rows, inconsistent control radii in the filter bar (`rounded-sm` search vs `rounded-lg` PEG select), and a page title (`PageTitle` at 16px) that competes with nav instead of anchoring the morning desk. Purple accent density is high but **intentional** per DESIGN.md's two-lane rule (AI Insights tab, portfolio name, AI badges) — not decorative slop.

**Deterministic scan (CLI):** 2 advisory findings — undocumented `rgb(0 0 0 / 0.12)` and `rgb(0 0 0 / 0.35)` shadow alphas in `globals.css` (lines 240, 244). Legitimate shadow tokens; document in DESIGN.md or alias to `--af-shadow-*`.

**Browser detector (live `/portfolio`, injection succeeded):** 18 overlays flagged:
- **14× `ai-color-palette`** — mostly false positives: intentional `text-purple-400` on portfolio name, AI Insights tab, tab badges per design system
- **1× `clipped-overflow-container`** — `AppContent` uses `overflow-x-clip`; verify dropdowns use portals (TabBar overflow menu does)
- **2× `cramped-padding`** — stats/header containers with tight vertical inset
- **1× `flat-type-hierarchy`** — 10px–18px type scale (expected for dense data UI; tighten to design tokens)

**Visual overlays:** Highlights are visible in the browser tab titled **AgentFloor [impeccable-preflight]** on `/portfolio`.

## Overall Impression

The layout-phase refactor delivers real structure — shared `PageShell`, aligned padding, portal-based tab overflow — and the holdings table is genuinely useful for research. The single biggest gap vs PRODUCT.md's "morning-first clarity" is **split attention**: portfolio value and AI briefing live on different tabs, and the default Holdings view buries the health narrative under metric chrome before the user sees what changed overnight.

## What's Working

1. **Semantic color discipline** — Blue for actions, purple for AI lanes, green/red/yellow reserved for verdicts and P&L. The stats bar groups performance / signals / regime with dividers instead of nested cards.
2. **TabBar overflow with portal** — "More" menu escapes `overflow-x-clip` via `createPortal`, focus trap, and viewport clamping. This is the right pattern for dense product nav.
3. **Data legibility** — `font-data` on totals and table numerics, sortable headers, and mobile `HoldingsMobileCards` show the team is designing for real portfolios, not demo data.

## Priority Issues

### [P1] Morning workflow is tab-fragmented
- **Why it matters:** PRODUCT.md positions the daily portfolio check as the hero flow. Health score and action items require switching to AI Insights; totals sit in a secondary strip below the page title row.
- **Fix:** Surface a compact "morning strip" on Holdings — latest insight stance + health score + top action item — with one-click drill to Insights. Or default tab to Insights when a fresh briefing exists (<12h).
- **Suggested command:** `/impeccable shape`

### [P1] Four important tabs hidden behind "More"
- **Why it matters:** Earnings, News, Chat, and Thesis are not edge features for this audience; burying them raises recall cost and hides the alert badge path for behavioral warnings on overflow tabs.
- **Fix:** Promote Earnings to primary (morning calendar is core) or use a two-row tab model / scrollable tab list instead of overflow. Keep Chat/Thesis in More only if analytics show low use.
- **Suggested command:** `/impeccable layout`

### [P1] Holdings view cognitive overload
- **Why it matters:** Stats bar (~8 metrics) + 4–5 filters + 10-column table exceeds working-memory limits at the primary decision point.
- **Fix:** Collapse stats bar to 3–4 morning-critical metrics; move regime distribution to expandable section; default filters collapsed behind a "Filter" chip.
- **Suggested command:** `/impeccable distill`

### [P2] Weak page hierarchy
- **Why it matters:** `PageTitle` renders at `text-base` (16px) — same weight band as table headers. Portfolio market value (the emotional anchor) is smaller than nav links visually.
- **Fix:** Use display scale for page title or promote totals into `PageHeader` actions row on desktop; apply `font-data` display sizing to market value.
- **Suggested command:** `/impeccable typeset`

### [P2] Inconsistent component vocabulary
- **Why it matters:** `PortfolioHeader` uses `rounded-sm`; stats bar `rounded-lg`; filter inputs mix `rounded-sm` and `rounded-lg`. Reads as incremental migration, not a system.
- **Fix:** Audit portfolio surface against DESIGN.md component tokens; migrate filters/inputs to `rounded-md` + shared `FIELD_INPUT_SM_CLASS`.
- **Suggested command:** `/impeccable polish`

## Persona Red Flags

**Alex (Power User):** Must click "More" to reach Earnings/News — extra step every morning. No keyboard shortcut for tab switching beyond global nav. Batch analyze is modal-only, not inline on stats bar stale CTA.

**Jordan (First-Timer):** "More" tab label gives no hint that earnings calendar lives inside. Uppercase "AI SIGNALS" / "REGIME" micro-labels read as enterprise admin, not consumer fintech. Auto-opening upload drawer on empty portfolio may feel like an error state.

**Sam (Accessibility):** `TabBar` sets `role="tablist"` but tab panels lack `role="tabpanel"` + `aria-labelledby` linkage. Holdings row icon buttons (edit/run/watch) need verified accessible names. Regime filter pills use color + bullet — not sufficient alone for color-blind users.

**Morgan (Morning Investor — project persona):** Opens app to check "what needs attention today" but lands on Holdings with no insight summary visible. Must mentally integrate stats bar numbers without narrative. Behavioral alert count on AI Insights tab is easy to miss when Holdings is default.

## Minor Observations

- Empty portfolio copy is plain centered text — `EmptyState` component exists elsewhere but not here.
- `InsightsDashboard` uses emoji severity icons (🔴🟡🔵) — slightly informal vs trust-by-default tone.
- `PageShell` gap `"4"` uses `space-y-4` while `"6"`/`"8"` use flex `gap-*` — subtle layout inconsistency.
- CLI shadow color drift in `globals.css` should be tokenized.

## Questions to Consider

- What if the first screen after login showed insight stance + overnight movers without a tab switch?
- Does every holdings row need visible regime + wave + trim badges, or should confluence compress to one indicator?
- What would a confident morning desk look like if you removed half the stats bar metrics?
