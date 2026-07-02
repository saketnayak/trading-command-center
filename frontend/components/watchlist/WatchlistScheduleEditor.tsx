"use client";

import { WatchlistScheduleBuilder } from "@/components/watchlist/WatchlistScheduleBuilder";

type WatchlistScheduleEditorProps = {
  ticker: string;
  cron: string | null;
  onCronChange: (cron: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
  instanceKey?: string;
};

export function WatchlistScheduleEditor({
  ticker,
  cron,
  onCronChange,
  onSave,
  onCancel,
  instanceKey,
}: WatchlistScheduleEditorProps) {
  return (
    <div className="rounded-sm border border-border bg-input/30 px-4 py-4 space-y-4">
      <p className="text-sm font-medium text-fg">Schedule for {ticker}</p>
      <WatchlistScheduleBuilder
        key={instanceKey}
        instanceKey={instanceKey}
        cron={cron}
        onCronChange={onCronChange}
        showLabel={false}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          className="bg-blue-600 hover:bg-blue-700 text-fg text-xs font-medium px-3 py-1.5 rounded-sm"
        >
          Save schedule
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted hover:text-fg-secondary px-3 py-1.5 border border-input-border rounded-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
