---
target: Portfolio (/portfolio) post-fix
total_score: 28
p0_count: 0
p1_count: 2
timestamp: 2026-06-29T17-32-51Z
slug: frontend-app-app-portfolio-page-tsx
---
# Critique: Portfolio (`/portfolio`) — post-fix re-run

**Target:** `frontend/app/(app)/portfolio/page.tsx` after morning-workflow UX commit (e155066)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Freshness label + briefing states solid; trim-signals still fails (CORS) |
| 2 | Match System / Real World | 3 | Morning strip uses plain language; table jargon (PEG, regime) unchanged |
| 3 | User Control and Freedom | 3 | Filters/stats collapsible; auto-upload drawer on empty snapshot remains |
| 4 | Consistency and Standards | 3 | Radii aligned on filters/stats; table cells still mix `rounded-sm` |
| 5 | Error Prevention | 3 | Earnings now visible; overflow still hides News/Chat/Thesis |
| 6 | Recognition Rather Than Recall | 3 | Morning strip surfaces insight on Holdings; More menu still required for news |
| 7 | Flexibility and Efficiency | 3 | Batch analyze, sort, keyboard shortcuts unchanged |
| 8 | Aesthetic and Minimalist Design | 3 | Stats/filters collapsed — meaningful improvement; table density remains |
| 9 | Error Recovery | 2 | Trim-signals CORS leaves sell-candidates panel empty without user message |
| 10 | Help and Documentation | 2 | Briefing CTA helps; no first-run morning workflow guidance |
| **Total** | | **28/40** | **Good — solid foundation; polish and table density are the remaining gaps** |

## Anti-Patterns Verdict

**LLM assessment:** Still not generic AI marketing slop. The recent fixes read as intentional product craft: morning briefing strip, promoted Earnings tab, and collapsed metric chrome move the page toward PRODUCT.md's morning-first goal. The remaining product-register tells are **density without hierarchy** (holdings table) and **purple lane overreach** — the new `MorningBriefStrip` adds another purple-bordered panel on top of tab accents, which the detector correctly flags. Uppercase micro-eyebrows are gone from the stats bar — a clear win.

**Deterministic scan (CLI):** Unchanged — 2 advisory shadow rgba values in `globals.css` (lines 240, 244).

**Browser detector (live `/portfolio`, injection succeeded):** 19 overlays (was 18):
- **14× `ai-color-palette`** — mostly intentional two-lane purple; strip + tab + portfolio name
- **2× `low-contrast`** — **new:** white text on `#c084fc` at 2.6:1 on purple AI buttons (`BTN_AI_SM_CLASS` / Generate briefing)
- **1× `clipped-overflow-container`** — `AppContent` `overflow-x-clip` (TabBar portal mitigates)
- **1× `cramped-padding`** — down from 2
- **`flat-type-hierarchy`** — no longer flagged (type scale tightened in stats)

**Visual overlays:** Visible in browser tab **AgentFloor [impeccable-preflight]** on `/portfolio`.

## Overall Impression

The last pass moved the needle. Holdings now opens with narrative context (health, stance, top action) instead of raw metrics alone, and the page feels less cluttered. The single biggest remaining opportunity is the **holdings table itself** — still a wide, expert-facing grid that dominates the viewport after the improved header chrome.

## What's Working

1. **MorningBriefStrip** — Delivers the insight story on Holdings without a tab switch. Directly addresses the prior P1 morning-workflow finding.
2. **Collapsed stats + filters** — Default Holdings view is scannable; power metrics and filters are one click away.
3. **Earnings in primary tabs** — Calendar workflow no longer buried in More; tab a11y wiring (`tabIdPrefix`, `tabpanel`) is production-appropriate.

## Priority Issues

### [P1] Purple AI button contrast fails in dark mode
- **Why it matters:** "Generate briefing" and "Analyze stale" use white/`text-fg` on purple ~2.6:1 — below 4.5:1 WCAG AA. Primary morning CTAs are the worst place for contrast failure.
- **Fix:** Use `text-on-accent` on `BTN_AI_*` classes or darken button bg in dark mode (`purple-700` bg, `purple-100` text).
- **Suggested command:** `/impeccable audit`

### [P1] Holdings table still dominates cognitive load
- **Why it matters:** After the strip and collapsed chrome, the 10-column table + expandable regime rows remain the visual and mental center of gravity.
- **Fix:** Hide low-priority columns behind column picker default; compress confluence badges to one column; or default mobile-first card view on md breakpoint.
- **Suggested command:** `/impeccable distill`

### [P2] News / Chat / Thesis still in overflow
- **Why it matters:** Improved from before, but News is a morning-relevant surface still behind More.
- **Fix:** Promote News to primary or use horizontal scroll tabs instead of overflow for 6 tabs.
- **Suggested command:** `/impeccable layout`

### [P2] Portfolio value hierarchy split across two bands
- **Why it matters:** Page title is now larger, but market value remains in `PortfolioHeader` below the title row — two scans to answer "how am I doing?"
- **Fix:** Merge totals into `PageHeader` on desktop, demote metadata (broker, quote currencies) to secondary line.
- **Suggested command:** `/impeccable typeset`

### [P3] Empty / no-portfolio states lack `EmptyState` component
- **Why it matters:** "No portfolios yet" is plain centered text — inconsistent with holdings empty state quality.
- **Fix:** Reuse `EmptyState` with upload/create CTA.
- **Suggested command:** `/impeccable onboard`

## Persona Red Flags

**Alex (Power User):** Still one click to News via More. Column-heavy table slows scanning vs. a configurable density toggle.

**Jordan (First-Timer):** Morning strip helps when insight exists; empty "No AI briefing yet" is clear. Table columns (PEG, regime expand) still assume expertise.

**Sam (Accessibility):** Tab panels wired — improvement. Purple AI buttons fail contrast check. Overflow tab panels use `aria-labelledby="portfolio-tab-overflow"` even when a specific overflow item (News) is active — imprecise label association.

**Morgan (Morning Investor):** Morning strip is the fix they needed — health + top action visible on landing. News calendar still requires discovering More.

## Minor Observations

- Trim-signals CORS errors persist in console (dev env; should surface UI fallback).
- `MorningBriefStrip` duplicates purple chrome already on AI Insights tab — consider neutral strip with purple CTA only (quieter).
- Shadow rgba tokens in `globals.css` still undocumented.

## Questions to Consider

- Should the morning strip be neutral-toned with a single purple CTA, letting the tab carry the AI lane?
- Which table columns could default hidden for portfolios under 20 holdings?
- Is News used often enough to earn primary tab status alongside Earnings?
