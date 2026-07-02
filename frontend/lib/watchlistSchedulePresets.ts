export const DEFAULT_WATCHLIST_CRON = "0 9 * * 1-5";

export type SchedulePresetId = "manual" | "weekdays" | "daily" | "weekly" | "custom";

export type SchedulePreset = {
  id: Exclude<SchedulePresetId, "manual" | "custom">;
  label: string;
  cron: string;
};

export const WATCHLIST_SCHEDULE_PRESETS: SchedulePreset[] = [
  { id: "weekdays", label: "Weekdays 9:00 AM", cron: "0 9 * * 1-5" },
  { id: "daily", label: "Daily 9:00 AM", cron: "0 9 * * *" },
  { id: "weekly", label: "Monday 9:00 AM", cron: "0 9 * * 1" },
];

export function resolveSchedulePreset(cron: string | null): SchedulePresetId {
  if (cron === null) return "manual";
  const match = WATCHLIST_SCHEDULE_PRESETS.find((preset) => preset.cron === cron);
  return match?.id ?? "custom";
}
