---
target: Portfolio (/portfolio) third run
total_score: 31
p0_count: 0
p1_count: 0
timestamp: 2026-06-29T17-36-44Z
slug: frontend-app-app-portfolio-page-tsx
---
# Critique: Portfolio (`/portfolio`) — third run

**Target:** `frontend/app/(app)/portfolio/page.tsx` after second UX pass (uncommitted)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Briefing + freshness solid; trim-signals CORS still silent |
| 2 | Match System / Real World | 3 | Morning flow reads naturally; table jargon when columns expanded |
| 3 | User Control and Freedom | 3 | Collapsible filters/columns; auto-upload drawer unchanged |
| 4 | Consistency and Standards | 3 | Totals/header/metadata split clean; PortfolioSwitcher still `rounded-sm` |
| 5 | Error Prevention | 3 | Four primary tabs visible; Chat/Thesis in More only |
| 6 | Recognition Rather Than Recall | 4 | Insight, earnings, news on primary row; empty state guides create |
| 7 | Flexibility and Efficiency | 3 | Column toggle + filters reward power users |
| 8 | Aesthetic and Minimalist Design | 4 | Default holdings view much leaner; header totals anchor hierarchy |
| 9 | Error Recovery | 2 | Trim-signals failure still no inline message |
| 10 | Help and Documentation | 3 | EmptyState onboarding; no first-run tour |
| **Total** | | **31/40** | **Good — polish and edge-case recovery remain** |

## Anti-Patterns Verdict

**LLM assessment:** Reads as a deliberate consumer-fintech research product, not AI slop. The arc across three critiques is clear: morning narrative on Holdings, promoted tabs, collapsed chrome, totals in the header, neutral briefing strip. Remaining tells are **tab crowding** on narrow viewports and **dev-only API failures** surfacing as empty panels.

**Deterministic scan (CLI):** Clean on portfolio component paths (0 findings).

**Browser detector:** 15 overlays (down from 19). **No `low-contrast` flags** — AI button fix confirmed. 12× `ai-color-palette` (tabs/badges, intentional); 1× `clipped-overflow-container`; 1× `cramped-padding`. Morning strip neutrality reduced purple noise vs prior run.

**Visual overlays:** Tab **AgentFloor [impeccable-preflight]** on `/portfolio`.

## Overall Impression

This is in good shape for the morning desk workflow. The page now answers "how am I doing?" and "what should I look at?" in the first viewport. Remaining work is refinement: mobile tab density, silent API failures, and a final polish pass on legacy `rounded-sm` controls.

## What's Working

1. **Header hierarchy** — `PortfolioTotalsSummary` in `PageHeader` puts market value where the eye lands first.
2. **Default holdings density** — Five-column default + toggles respects both novices and power users.
3. **Contrast fix** — Purple AI CTAs no longer fail browser contrast checks.

## Priority Issues

### [P2] Primary tab bar may crowd on mobile
Four primary tabs (Holdings, AI Insights, Earnings, News) can wrap or compress on narrow screens.
**Fix:** Horizontal scroll tablist on `sm` breakpoint or shorten labels ("Insights", "News").
**Suggested command:** `/impeccable adapt`

### [P2] Trim-signals failure is invisible to users
CORS errors in dev leave sell-candidates/trim UI empty without explanation.
**Fix:** Surface API error state in `SellCandidatesPanel` / trim column; fix CORS in dev stack.
**Suggested command:** `/impeccable harden`

### [P3] "More columns" hides expert signals without affordance hint
Regime/PEG/wave badges hidden until toggle — expand rows still carry detail but no hint on collapsed rows.
**Fix:** Tooltip on toggle or subtle "Signals in more columns" helper when regime data exists.
**Suggested command:** `/impeccable clarify`

### [P3] PortfolioSwitcher / legacy controls still `rounded-sm`
Minor vocabulary drift vs `rounded-md`/`rounded-lg` elsewhere.
**Suggested command:** `/impeccable polish`

## Persona Red Flags

**Alex:** Happy with column toggle. Chat/Thesis still behind More — acceptable if low use.

**Jordan:** EmptyState + morning strip strong. May not discover "More columns" for regime context.

**Sam:** Contrast fixed. Four primary tabs may truncate on small screens — test 320px.

**Morgan:** Morning workflow largely delivered — briefing + totals + news tab without hunting.

## Minor Observations

- Metadata strip (`PortfolioHeader`) is appropriately quiet below totals.
- Chat + Thesis as only overflow tabs is a sensible IA compromise.
- CLI scan clean on touched files.

## Questions to Consider

- Does News earn its primary slot on mobile, or scroll tabs?
- Should trim-signals errors show a single portfolio-level banner?
- Ready for `/impeccable polish` as a final pass before ship?
