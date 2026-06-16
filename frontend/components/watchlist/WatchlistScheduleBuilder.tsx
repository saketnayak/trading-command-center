"use client";

import { Cron } from "react-js-cron";
import "react-js-cron/dist/styles.css";

export const DEFAULT_WATCHLIST_CRON = "0 9 * * 1-5";

export interface WatchlistScheduleBuilderProps {
  cron: string | null;
  onCronChange: (cron: string | null) => void;
  /** Forces react-js-cron to remount with stored cron when editing an item. */
  instanceKey?: string;
}

export function WatchlistScheduleBuilder({
  cron,
  onCronChange,
  instanceKey,
}: WatchlistScheduleBuilderProps) {
  const manualOnly = cron === null;
  const cronValue = cron ?? DEFAULT_WATCHLIST_CRON;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-fg-secondary cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={manualOnly}
          onChange={(e) => onCronChange(e.target.checked ? null : DEFAULT_WATCHLIST_CRON)}
          className="rounded border-input-border"
        />
        Manual only (no automatic schedule)
      </label>

      {!manualOnly && (
        <div className="watchlist-cron-builder rounded-lg border border-input-border bg-page/60 p-3 overflow-x-auto">
          <Cron
            key={instanceKey ?? cronValue}
            value={cronValue}
            setValue={(value: string) => onCronChange(value)}
            className="watchlist-cron"
          />
        </div>
      )}

      {!manualOnly && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted">Expression:</span>
          <code className="text-xs text-blue-300 bg-page border border-border px-2 py-0.5 rounded-sm">
            {cronValue}
          </code>
        </div>
      )}
    </div>
  );
}
