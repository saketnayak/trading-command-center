/** Shared field styles — aligned with RunForm and LlmConfigPicker. */
export const WATCHLIST_FIELD_LABEL_CLASS = "block text-muted text-xs mb-1";
export const WATCHLIST_FIELD_INPUT_CLASS =
  "w-full bg-input border border-input-border rounded-sm px-3 py-2 text-fg text-sm focus:outline-hidden focus:border-blue-600";

export function watchlistAnalystPillClass(selected: boolean): string {
  return selected
    ? "px-3 py-1 rounded-sm border text-xs capitalize bg-blue-700 text-fg border-blue-600"
    : "px-3 py-1 rounded-sm border text-xs capitalize bg-input text-muted border-input-border hover:border-border-strong";
}

export function watchlistPresetPillClass(active: boolean, compact = false): string {
  const size = compact
    ? "px-2 py-1 text-[11px]"
    : "px-3 py-1.5 text-xs";
  return active
    ? `${size} rounded-sm border bg-blue-700/80 text-fg border-blue-600`
    : `${size} rounded-sm border bg-input text-muted border-input-border hover:border-border-strong hover:text-fg-secondary`;
}
