/** Curated IANA timezones for schedule/delivery pickers (fallback when full list unavailable). */
export const IANA_TIMEZONES = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Toronto", "America/Vancouver", "America/Sao_Paulo", "America/Buenos_Aires",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome",
  "Europe/Amsterdam", "Europe/Stockholm", "Europe/Helsinki", "Europe/Moscow",
  "Africa/Cairo", "Africa/Johannesburg",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore",
  "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Sydney", "Australia/Melbourne",
  "Pacific/Auckland", "Pacific/Honolulu",
] as const;

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Full IANA list when supported; otherwise curated list. */
export function getIanaTimezoneOptions(): string[] {
  try {
    if (typeof Intl !== "undefined" && "supportedValuesOf" in Intl) {
      return [...Intl.supportedValuesOf("timeZone")].sort((a, b) => a.localeCompare(b));
    }
  } catch {
    // fall through to curated list
  }
  return [...IANA_TIMEZONES];
}

/** Ensures `value` appears in the select even if outside curated/fallback lists. */
export function timezoneSelectOptions(value: string): string[] {
  const base = getIanaTimezoneOptions();
  if (base.includes(value)) return base;
  return [value, ...base];
}
