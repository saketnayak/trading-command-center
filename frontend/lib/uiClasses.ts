/** Shared UI class strings — aligned with DESIGN.md (Morning Desk / consumer fintech). */

export const FIELD_LABEL_CLASS =
  "mb-1 block text-xs font-medium uppercase tracking-wide text-muted";

export const FIELD_INPUT_CLASS =
  "w-full rounded-md border border-input-border bg-input px-3 py-2 text-sm text-fg transition-colors focus:border-blue-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500/30";

export const FIELD_INPUT_SM_CLASS =
  "w-full rounded-md border border-input-border bg-input px-2 py-1.5 text-sm text-fg transition-colors focus:border-blue-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500/30";

export const BTN_PRIMARY_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_PRIMARY_SM_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-fg transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_SECONDARY_CLASS =
  "inline-flex items-center justify-center rounded-lg border border-input-border bg-surface px-3 py-2 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:bg-muted-surface hover:text-fg disabled:opacity-50";

/** Amber warning strip — Finnhub missing, partial data, trim errors. */
export const ALERT_BANNER_CLASS =
  "text-xs text-amber-400/90 bg-amber-900/20 border border-amber-700/40 rounded-md px-3 py-2";

export const BTN_GHOST_CLASS =
  "rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-fg disabled:opacity-30";

export const BTN_AI_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-purple-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600 dark:bg-purple-900 dark:hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_AI_SM_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-purple-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-purple-600 dark:bg-purple-900 dark:hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_DANGER_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-red-700 px-3 py-2 text-xs font-medium text-fg transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40";

export const BTN_DANGER_SM_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40";

export const BTN_ICON_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-muted-surface hover:text-fg disabled:opacity-40";

export function selectionPillClass(selected: boolean, compact = false): string {
  const size = compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  return selected
    ? `${size} rounded-lg border border-blue-600 bg-blue-700/90 font-medium capitalize text-fg`
    : `${size} rounded-lg border border-input-border bg-input capitalize text-muted transition-colors hover:border-border-strong hover:text-fg-secondary`;
}

export function aiSelectionPillClass(selected: boolean): string {
  return selected
    ? "rounded-lg border border-purple-600 bg-purple-100 px-3 py-1.5 text-sm text-purple-800 transition-colors dark:border-purple-500/50 dark:bg-purple-500/20 dark:text-purple-300"
    : "rounded-lg border border-input-border bg-input px-3 py-1.5 text-sm text-muted transition-colors hover:border-border-strong hover:text-fg";
}

/** Circular analyst icon chips (run detail tabs, watchlist, pipeline). */
export const ANALYST_ICON_BADGE: Record<string, string> = {
  market:
    "text-blue-700 bg-blue-100 border-blue-200 dark:text-blue-300 dark:bg-blue-950/50 dark:border-blue-700/50",
  social:
    "text-pink-700 bg-pink-100 border-pink-200 dark:text-pink-300 dark:bg-pink-950/40 dark:border-pink-700/40",
  news:
    "text-amber-700 bg-amber-100 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-700/40",
  fundamentals:
    "text-emerald-700 bg-emerald-100 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-700/40",
};

export const ANALYST_ICON_BADGE_FALLBACK = "text-muted bg-muted-surface border-input-border";

export const LANGUAGE_FLAG_BADGE =
  "border-violet-200 bg-violet-100 dark:border-violet-700/40 dark:bg-violet-950/40";

export const ANALYST_TAB_ACTIVE_CLASS =
  "border-b-2 border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-400";

export function signalToneBadgeClass(tone: "success" | "warning" | "danger" | "neutral"): string {
  switch (tone) {
    case "success":
      return "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30";
    case "warning":
      return "text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30";
    case "danger":
      return "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30";
    default:
      return "text-muted bg-muted-surface";
  }
}

export function agreementBannerClass(agrees: boolean): string {
  return agrees
    ? "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400"
    : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400";
}

export function matrixCellToneClass(value: number): string {
  if (value >= 0.7) return "text-green-800 bg-green-100 dark:text-green-300 dark:bg-green-900/40";
  if (value >= 0.5) return "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/20";
  if (value >= 0.3) return "text-amber-700 bg-amber-50 dark:text-yellow-400 dark:bg-yellow-900/20";
  return "text-muted";
}
