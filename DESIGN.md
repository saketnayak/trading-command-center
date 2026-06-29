---
name: AgentFloor
description: Self-hosted AI investment research command center — morning-first portfolio clarity
colors:
  page: "#f1f5f9"
  page-dark: "#0a0e1a"
  surface: "#ffffff"
  surface-dark: "#0f1629"
  elevated: "#f8fafc"
  elevated-dark: "#0d1220"
  muted-surface: "#e2e8f0"
  muted-surface-dark: "#1a1d2e"
  ink: "#0f172a"
  ink-dark: "#e2e8f0"
  ink-secondary: "#1e293b"
  ink-secondary-dark: "#cbd5e1"
  muted-text: "#475569"
  muted-text-dark: "#94a3b8"
  border: "#e2e8f0"
  border-dark: "#1e293b"
  border-strong: "#cbd5e1"
  border-strong-dark: "#334155"
  action-blue: "#1d4ed8"
  action-blue-dark: "#60a5fa"
  action-blue-hover: "#1e40af"
  action-blue-hover-dark: "#93c5fd"
  ai-accent: "#7e22ce"
  ai-accent-dark: "#c084fc"
  ai-accent-soft: "#f3e8ff"
  ai-accent-soft-dark: "#581c87"
  success: "#15803d"
  success-dark: "#4ade80"
  success-soft: "#dcfce7"
  success-soft-dark: "#14532d"
  danger: "#b91c1c"
  danger-dark: "#f87171"
  danger-soft: "#fee2e2"
  danger-soft-dark: "#7f1d1d"
  warning: "#b45309"
  warning-dark: "#fbbf24"
  warning-soft: "#fef3c7"
  warning-soft-dark: "#713f12"
  on-accent: "#ffffff"
typography:
  display:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 4vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  title:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.01em"
  data:
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
    fontFeatureSettings: "\"tnum\""
rounded:
  sm: "0.125rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-hover}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  button-ai:
    backgroundColor: "{colors.ai-accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  card-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1rem 1.25rem"
---

# Design System: AgentFloor

## Overview

**Creative North Star: "The Morning Desk"**

AgentFloor should feel like opening a well-designed consumer fintech app at the start of the trading day: calm, scannable, and confident. The visual system serves research workflows — portfolio holdings, AI briefings, run verdicts — not marketing spectacle. Surfaces are organized in clear tonal steps (page → surface → elevated) so dense data is used_rule badges remain readable without legacy enterprise gray-box fatigue.

The system explicitly rejects legacy enterprise admin panels, gamified trading chrome, generic AI purple-gradient slop, and crypto hype aesthetics (see PRODUCT.md anti-references). Light and dark modes share the same semantic roles; dark mode is a first-class research environment, not an afterthought.

**Key Characteristics:**

- Morning-first hierarchy — portfolio and briefing surfaces lead; drill-down depth on demand
- Semantic color discipline — blue for navigation/actions, purple for AI generation, green/red/yellow for verdicts and P&L only
- Tonal depth over shadow theater — borders and surface steps convey structure; shadows reserved for overlays
- Soft consumer fintech touch — generous radius (8–12px on primary controls), comfortable padding, pill status badges
- Data legibility — Geist Mono with tabular numerals for prices, P&L, and metrics

## Colors

A restrained slate neutral foundation with two intentional accent lanes: trustworthy blue for user actions and research purple for AI-powered flows.

### Primary

- **Action Blue** (#1d4ed8 light / #60a5fa dark): Primary CTAs — New Run, Save, links, nav active states. The default "do something" color for human-initiated actions.
- **Action Blue Hover** (#1e40af light / #93c5fd dark): Hover and emphasis on primary actions.

### Secondary

- **AI Accent** (#7e22ce light / #c084fc dark): AI generation flows only — portfolio insights, batch analyze, tab badges for AI features. Never use for generic decoration.
- **AI Accent Soft** (#f3e8ff light / #581c87 dark): Subtle AI context backgrounds and upload drop-zone highlights.

### Tertiary

- **Info Blue** (#2563eb light / #60a5fa dark): Informational badges, focus rings, chart quick-look highlights.

### Neutral

- **Slate Page** (#f1f5f9 / #0a0e1a): App canvas background behind all content.
- **Surface White** (#ffffff / #0f1629): Primary panels, cards, table rows.
- **Elevated Mist** (#f8fafc / #0d1220): Nested panels, confirmation strips, secondary containers.
- **Muted Surface** (#e2e8f0 / #1a1d2e): Hover fills, icon button backgrounds, disabled-adjacent areas.
- **Ink Primary** (#0f172a / #e2e8f0): Body text and headings.
- **Ink Secondary** (#1e293b / #cbd5e1): Supporting labels and secondary copy.
- **Muted Text** (#475569 / #94a3b8): Captions, table metadata, helper text — never for long-form body copy.
- **Border Hairline** (#e2e8f0 / #1e293b): Default panel and row dividers.
- **Border Strong** (#cbd5e1 / #334155): Input borders, emphasized separators.

### Semantic (Verdict & P&L only)

- **Gain Green** (#15803d / #4ade80) + **Gain Soft** backgrounds for buy signals and positive P&L.
- **Loss Red** (#b91c1c / #f87171) + **Loss Soft** backgrounds for sell signals and negative P&L.
- **Caution Amber** (#b45309 / #fbbf24) + **Caution Soft** for hold verdicts and warnings.

### Named Rules

**The Two-Lane Rule.** Blue is for human navigation and standard actions. Purple is for AI generation. Do not cross these lanes — purple "Generate Insight" buttons are correct; purple "Save" or "Export" buttons are not.

**The Verdict-Only Rule.** Green, red, and yellow carry financial meaning (buy/sell/hold, P&L direction). Never use them for generic success toasts, decorative badges, or non-financial status.

## Typography

**Display Font:** Geist Sans (local variable, `--font-geist-sans`)
**Body Font:** Geist Sans
**Data Font:** Geist Mono (`--font-geist-mono`, tabular nums via `font-data` utility)

**Character:** Clean geometric sans with mono for numbers — modern consumer fintech readability without terminal austerity. Pairing is single-family with weight/size hierarchy, not mixed display serifs.

### Hierarchy

- **Display** (600, clamp 1.5–2.25rem, 1.2): Page titles, portfolio totals, insight health score ring labels.
- **Headline** (600, 1.125rem / 18px, 1.3): Section headers, card titles, modal headings.
- **Title** (500, 0.875rem / 14px, 1.4): Table column headers, tab labels, form field labels.
- **Body** (400, 0.875rem / 14px, 1.5, max ~65ch for report prose via `prose-report`): Default UI copy and markdown report bodies.
- **Label** (500, 0.75rem / 12px, 1.25): Badges, metadata chips, cron builder hints.
- **Data** (400 mono, 0.8125rem, tabular-nums): Prices, shares, P&L percentages, run IDs.

### Named Rules

**The Tabular Rule.** All numeric financial data uses Geist Mono with tabular figures. Never rely on proportional sans for aligned decimal columns.

**The Muted-Body Ban.** `--af-muted` (#475569) is for captions and metadata only. Body paragraphs and table cell primary text use `--af-fg` or `--af-fg-secondary`.

## Elevation

AgentFloor uses **tonal layering** as the primary depth model. The page background sits lowest; surfaces step up through `surface` and `elevated`; nested detail strips use `page` tint inside `elevated` borders. Shadows are sparse — reserved for mobile nav drawer, chart quick-look popovers, and modal overlays (`shadow-lg`, `shadow-2xl`), not for every card at rest.

### Shadow Vocabulary

- **Overlay lift** (`0 10px 15px -3px rgb(0 0 0 / 0.1)` class equivalent): Mobile nav panel, dropdown menus.
- **Popover depth** (`shadow-2xl`): Chart quick-look floating panel.
- **Micro lift** (`0 1px 2px rgb(0 0 0 / 0.12)`): Drag cards in CSV importer only.

### Named Rules

**The Flat-Panel Rule.** Holdings rows, run cards, and insight panels use border + background step, not drop shadows. If a container looks like it's floating without user interaction, remove the shadow.

## Components

Soft consumer fintech feel: 8px radius on panels (`rounded-lg`), 8–12px on primary buttons, pill badges for status (`rounded-full`), comfortable horizontal padding on nav and forms.

### Buttons

- **Shape:** 8px radius (`rounded-lg`) for primary/empty-state CTAs; 2px (`rounded-sm`) for compact inline actions migrating toward lg over time.
- **Primary:** Action blue background, white text, `px-4 py-2`, `text-sm font-medium`, hover darkens blue one step.
- **AI Primary:** Purple accent background for generate/analyze actions; same sizing as primary.
- **Ghost / Secondary:** Border `border-input-border`, background `bg-input/30` or `bg-muted-surface`, hover elevates to `border-strong`.
- **Icon Button:** 28×28px hit target, `rounded-sm`, muted default, tone-specific hover (blue/green/red/yellow) — never purple unless AI-related.

### Chips & Badges

- **Verdict pills:** `rounded-lg` or `rounded-full`, soft semantic background (`bg-green-900 text-green-300` pattern) for BUY/SELL/HOLD.
- **Status pills:** `rounded-full`, `text-xs px-2 py-0.5` for enabled/disabled watchlist items.
- **Regime / Wave badges:** Compact `rounded-md border` strips inline with ticker rows.

### Cards / Containers

- **Corner Style:** 8px (`rounded-lg`) standard; 12px (`rounded-xl`) for chart popovers.
- **Background:** `bg-surface` on `bg-page` canvas; nested strips use `bg-elevated` or `bg-page` with `border-input-border`.
- **Border:** 1px `border-border` default; `border-input-border` for form-adjacent nested blocks.
- **Internal Padding:** `p-4` to `p-5` on sections; table cells tighter.

### Inputs / Fields

- **Style:** `bg-input`, `border-input-border`, `rounded-md` (6px) to `rounded-sm` in legacy forms — prefer md/lg for new work.
- **Focus:** `focus-visible:ring-2 focus-visible:ring-blue-500` with offset on interactive controls.
- **Cron / Select (antd):** Themed via `.watchlist-cron-builder` overrides to match slate tokens.

### Navigation

- **Top nav:** Horizontal links, muted default, blue underline + text for active route. Logo + primary nav + Research dropdown + theme toggle.
- **Tab bar:** Bottom border indicator; active tab `border-purple-500` (AI-adjacent sections) or context-appropriate accent; alert count in red mono badge.
- **Mobile:** Full-width `bg-surface shadow-lg` drawer; stacked links with `rounded-sm` active fill.

### Empty State

- Centered `rounded-lg border-border bg-surface` panel, circular `bg-elevated` icon well, primary blue CTA button.

### Signature: Trader Decision / Confluence Strip

- Three-column verdict grid with semantic color columns (buy/sell/hold), `rounded-sm border`, monospace-friendly price levels. Confluence badges (Markov, Wave, Kalman) use expandable `details` panels with agreement/conflict border colors.

## Do's and Don'ts

### Do:

- **Do** use semantic tokens (`bg-surface`, `text-fg`, `border-border`) over raw Tailwind palette classes in new code.
- **Do** keep the morning portfolio check scannable — stats bar, health score, and action items above the fold on Insights.
- **Do** reserve purple for AI-powered flows and tab indicators tied to AI features.
- **Do** use Geist Mono + tabular nums for all financial figures in tables and outcome grids.
- **Do** support both light and dark with paired token values; test contrast on `muted-text` against `elevated` backgrounds.
- **Do** use portals or fixed positioning for dropdowns inside scrollable table containers.

### Don't:

- **Don't** build legacy enterprise admin panels — gray boxes, cramped tables, tiny type, 2005-era density.
- **Don't** use gamified trading patterns — streaks, confetti, casino energy, urgency theater.
- **Don't** apply generic AI slop — purple gradient chrome everywhere, chatbot-first layouts, vague "AI magic" copy.
- **Don't** use crypto meme aesthetics — neon gradients, rocket emojis, hype-driven CTAs.
- **Don't** use green/red/yellow for non-financial status (generic success/error toasts should use neutral + icon, or blue/info).
- **Don't** add colored left-border stripes on cards or list items as accent decoration.
- **Don't** use gradient text or glassmorphism hero treatments inside the app shell.
- **Don't** nest cards inside cards — use tonal steps and dividers instead.
