---
target: Portfolio (/portfolio) fourth run
total_score: 34
p0_count: 0
p1_count: 0
timestamp: 2026-06-29T17-41-40Z
slug: frontend-app-app-portfolio-page-tsx
---
# Critique: Portfolio (`/portfolio`) — fourth run

**Target:** `frontend/app/(app)/portfolio/page.tsx` after third UX pass (`163efdf`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Trim-signals retry banner; freshness label intact |
| 2 | Match System / Real World | 3 | Expert columns still jargon-heavy when expanded |
| 3 | User Control and Freedom | 4 | Auto-upload drawer removed; explicit CSV CTA on empty state |
| 4 | Consistency and Standards | 3 | Header/switcher aligned; legacy `rounded-sm` in secondary panels |
| 5 | Error Prevention | 3 | Four scrollable primary tabs; overflow for Chat/Thesis |
| 6 | Recognition Rather Than Recall | 4 | Morning strip + promoted tabs + column hint copy |
| 7 | Flexibility and Efficiency | 4 | Filters/columns toggles; short mobile tab labels |
| 8 | Aesthetic and Minimalist Design | 4 | Default holdings lean; totals in header |
| 9 | Error Recovery | 3 | Trim API errors surfaced; fundamentals backend fix |
| 10 | Help and Documentation | 3 | EmptyState upload path; no guided tour |
| **Total** | | **34/40** | **Strong — ship-ready with optional deep polish** |

## Anti-Patterns Verdict

**LLM assessment:** Mature product UI. Morning workflow is coherent end-to-end. Remaining drift is cosmetic (`rounded-sm` in Insights/Earnings panels) and expert-mode density when columns expanded.

**Deterministic scan:** 0 findings on touched portfolio paths.

## Priority Issues

### [P3] Secondary panels still use legacy `rounded-sm`
Insights, Earnings, News warning strips and inputs predate the header polish pass.
**Suggested command:** `/impeccable polish` (scoped to tab panels)

### [P3] Expert column mode still dense
Power users benefit; novices may need glossary tooltips on Regime/PEG headers.
**Suggested command:** `/impeccable clarify`

## What's Working

1. Trim-signals failure is visible with retry — no silent empty sell panel.
2. Mobile tab bar scrolls with short labels (`Insights`, `Earn.`).
3. Empty holdings offer Add row + Upload CSV without forcing the drawer open.

## Questions to Consider

- Ship this branch or run one more scoped polish on Insights/Earnings panels?
- Promote Chat if usage data shows it's a morning workflow step?
