import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";
import type { Locale } from "react-js-cron";

/** Shorter copy so custom fields fit the narrow watchlist column. */
export const WATCHLIST_CRON_LOCALE: Locale = {
  prefixPeriod: "Every",
  prefixHours: "at",
  prefixMinutes: ":",
  prefixMonths: "in",
  prefixMonthDays: "on day",
  prefixWeekDays: "on",
  prefixWeekDaysForMonthAndYearPeriod: "and",
  prefixMinutesForHourPeriod: "at",
  suffixMinutesForHourPeriod: "minute(s) past the hour",
  emptyHours: "hour",
  emptyMinutes: "minute",
  emptyMinutesForHourPeriod: "minute",
  emptyMonths: "every month",
  emptyMonthDays: "every day",
  emptyMonthDaysShort: "day",
  emptyWeekDays: "every day",
  emptyWeekDaysShort: "day",
  dayOption: "day",
  weekOption: "week",
  monthOption: "month",
};

export function watchlistCronAntdTheme(isDark: boolean, compact: boolean): ThemeConfig {
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorBgContainer: "var(--af-input)",
      colorBgElevated: "var(--af-surface)",
      colorBorder: "var(--af-input-border)",
      colorText: "var(--af-fg)",
      colorTextSecondary: "var(--af-muted)",
      colorTextPlaceholder: "var(--af-muted)",
      colorTextQuaternary: "var(--af-muted)",
      colorPrimary: "var(--af-link)",
      colorPrimaryHover: "var(--af-link-hover)",
      borderRadius: 2,
      controlHeight: compact ? 32 : 36,
      fontSize: compact ? 12 : 14,
      lineHeight: 1.25,
    },
    components: {
      Select: {
        selectorBg: "var(--af-input)",
      },
    },
  };
}
