"use client";

import { useEffect, useRef, useState } from "react";
import { ConfigProvider } from "antd";
import { useTheme } from "next-themes";
import { Cron } from "react-js-cron";
import "react-js-cron/dist/styles.css";
import {
  DEFAULT_WATCHLIST_CRON,
  resolveSchedulePreset,
  WATCHLIST_SCHEDULE_PRESETS,
  type SchedulePresetId,
} from "@/lib/watchlistSchedulePresets";
import { watchlistPresetPillClass } from "./watchlistFormStyles";
import { WATCHLIST_CRON_LOCALE, watchlistCronAntdTheme } from "./watchlistCronTheme";

export { DEFAULT_WATCHLIST_CRON };

export type WatchlistScheduleBuilderProps = {
  cron: string | null;
  onCronChange: (cron: string | null) => void;
  /** Forces react-js-cron to remount with stored cron when editing an item. */
  instanceKey?: string;
  /** Hide section label when embedded in a labeled form row. */
  showLabel?: boolean;
  /** Tighter layout for narrow columns (add-ticker left pane). */
  compact?: boolean;
};

export function WatchlistScheduleBuilder({
  cron,
  onCronChange,
  instanceKey,
  showLabel = true,
  compact = false,
}: WatchlistScheduleBuilderProps) {
  const cronContainerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [themeReady, setThemeReady] = useState(false);
  const manualOnly = cron === null;
  const detectedPreset = resolveSchedulePreset(cron);
  const [presetId, setPresetId] = useState<SchedulePresetId>(detectedPreset);

  useEffect(() => {
    setThemeReady(true);
  }, []);

  useEffect(() => {
    setPresetId(resolveSchedulePreset(cron));
  }, [cron]);

  const cronValue = cron ?? DEFAULT_WATCHLIST_CRON;
  const showCustomBuilder = !manualOnly && presetId === "custom";
  const isDark = themeReady ? resolvedTheme === "dark" : true;

  function selectPreset(next: SchedulePresetId) {
    setPresetId(next);
    if (next === "manual") {
      onCronChange(null);
      return;
    }
    if (next === "custom") {
      onCronChange(cron ?? DEFAULT_WATCHLIST_CRON);
      return;
    }
    const preset = WATCHLIST_SCHEDULE_PRESETS.find((item) => item.id === next);
    if (preset) onCronChange(preset.cron);
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className={`flex flex-col gap-2 ${compact ? "" : "sm:flex-row sm:items-center sm:justify-between"}`}>
        {showLabel ? <span className="text-muted text-xs">Schedule</span> : null}
        <label
          className={`inline-flex items-center gap-2 text-fg-secondary cursor-pointer ${compact ? "text-[11px] leading-snug" : "text-xs sm:ml-auto"}`}
        >
          <input
            type="checkbox"
            checked={manualOnly}
            onChange={(e) => selectPreset(e.target.checked ? "manual" : "weekdays")}
            className="rounded-sm border-input-border accent-blue-600"
          />
          Manual only
        </label>
      </div>

      {!manualOnly && (
        <>
          <div className={`flex flex-wrap ${compact ? "gap-1.5" : "gap-2"}`}>
            {WATCHLIST_SCHEDULE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset.id)}
                className={watchlistPresetPillClass(presetId === preset.id, compact)}
              >
                {compact ? preset.label.replace(" AM", "").replace("Monday", "Mon") : preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => selectPreset("custom")}
              className={watchlistPresetPillClass(presetId === "custom", compact)}
            >
              Custom…
            </button>
          </div>

          {showCustomBuilder && (
            <div
              ref={cronContainerRef}
              className={`watchlist-cron-builder rounded-sm border border-input-border bg-input/40 overflow-x-auto ${
                compact ? "watchlist-cron-builder-compact px-2.5 py-2.5" : "px-3 py-3"
              }`}
            >
              <ConfigProvider theme={watchlistCronAntdTheme(isDark, compact)}>
                <Cron
                  key={instanceKey ?? cronValue}
                  value={cronValue}
                  setValue={(value: string) => onCronChange(value)}
                  humanizeLabels
                  humanizeValue
                  clockFormat="12-hour-clock"
                  leadingZero
                  clearButton={false}
                  allowedPeriods={["day", "week", "month"]}
                  locale={WATCHLIST_CRON_LOCALE}
                  getPopupContainer={() => cronContainerRef.current ?? document.body}
                  className="watchlist-cron"
                />
              </ConfigProvider>
            </div>
          )}

          <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "text-[11px]" : "text-xs"}`}>
            <span className="text-muted">Cron</span>
            <code className="font-data rounded-sm border border-border bg-page px-1.5 py-0.5 text-blue-400">
              {cronValue}
            </code>
          </div>
        </>
      )}

      {manualOnly && (
        <p className={`text-muted ${compact ? "text-[11px] leading-snug" : "text-xs"}`}>
          Runs only when you trigger them manually.
        </p>
      )}
    </div>
  );
}
