import {
  FIELD_INPUT_CLASS,
  FIELD_LABEL_CLASS,
  aiSelectionPillClass,
  selectionPillClass,
} from "@/lib/uiClasses";

/** Shared field styles — aligned with RunForm and LlmConfigPicker. */
export const WATCHLIST_FIELD_LABEL_CLASS = FIELD_LABEL_CLASS;
export const WATCHLIST_FIELD_INPUT_CLASS = FIELD_INPUT_CLASS;

export function watchlistAnalystPillClass(selected: boolean): string {
  return selectionPillClass(selected);
}

export function watchlistPresetPillClass(active: boolean, compact = false): string {
  return selectionPillClass(active, compact);
}

export { aiSelectionPillClass };
