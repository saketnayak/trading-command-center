"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Pause, Play, Trash2 } from "lucide-react";
import { TickerLabel } from "@/components/ui/TickerLabel";
import { IconButton } from "@/components/ui/IconButton";
import { AnalystIcons, LanguageFlag } from "@/components/runs/RunContextIcons";
import { CronLabel } from "@/components/watchlist/CronLabel";
import { WatchlistScheduleEditor } from "@/components/watchlist/WatchlistScheduleEditor";
import type { TickerMetadata, WatchlistItem } from "@/lib/types";

type WatchlistItemCardProps = {
  item: WatchlistItem;
  metadata?: TickerMetadata;
  onRemove: () => void;
  onToggle: () => void;
  onRunNow: () => void;
  onSaveSchedule: (cron: string | null) => void;
};

export function WatchlistItemCard({
  item,
  metadata,
  onRemove,
  onToggle,
  onRunNow,
  onSaveSchedule,
}: WatchlistItemCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [draftCron, setDraftCron] = useState<string | null>(item.schedule_cron);
  const [scheduleEditorKey, setScheduleEditorKey] = useState(0);

  return (
    <article className="rounded-lg border border-border bg-surface p-4 space-y-3 md:hidden">
      <div className="flex items-start justify-between gap-3">
        <TickerLabel ticker={item.ticker} metadata={metadata} />
        <span
          className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${item.enabled ? "bg-green-900/40 text-green-400" : "bg-input text-muted"}`}
        >
          {item.enabled ? "Active" : "Paused"}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div>
          {item.last_run_at && item.last_run_id ? (
            <Link href={`/runs/${item.last_run_id}`} className="text-blue-400 hover:underline">
              Last run {new Date(item.last_run_at).toLocaleDateString()}
            </Link>
          ) : (
            <span className="text-muted">Never run</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-blue-400 hover:underline"
        >
          {expanded ? "Hide config" : "Show model & schedule"}
        </button>
      </div>

      {expanded && (
        <div className="rounded-sm bg-input/30 px-3 py-2 text-xs text-fg-secondary space-y-2">
          <p>
            <span className="text-muted">Model </span>
            {item.llm_provider} / {item.llm_model} · depth {item.depth}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageFlag value={item.response_language} />
            <AnalystIcons analysts={item.analysts} />
          </div>
          <CronLabel cron={item.schedule_cron} nextRunAt={item.next_run_at} />
        </div>
      )}

      {editingSchedule && (
        <WatchlistScheduleEditor
          ticker={item.ticker}
          cron={draftCron}
          onCronChange={setDraftCron}
          instanceKey={`${item.id}-${item.schedule_cron ?? "manual"}-${scheduleEditorKey}`}
          onSave={() => {
            onSaveSchedule(draftCron);
            setEditingSchedule(false);
          }}
          onCancel={() => setEditingSchedule(false)}
        />
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <IconButton
          icon={Play}
          label={`Run ${item.ticker} now`}
          title="Run now"
          tone="primary"
          onClick={onRunNow}
        />
        <IconButton
          icon={CalendarClock}
          label={`Edit ${item.ticker} schedule`}
          title="Edit schedule"
          tone="default"
          onClick={() => {
            setDraftCron(item.schedule_cron);
            setScheduleEditorKey((k) => k + 1);
            setEditingSchedule((v) => !v);
            setExpanded(true);
          }}
        />
        <IconButton
          icon={item.enabled ? Pause : Play}
          label={item.enabled ? `Pause ${item.ticker} schedule` : `Resume ${item.ticker} schedule`}
          title={item.enabled ? "Pause" : "Resume"}
          tone="default"
          onClick={onToggle}
        />
        <IconButton
          icon={Trash2}
          label={`Remove ${item.ticker} from watchlist`}
          title="Remove"
          tone="danger"
          onClick={onRemove}
        />
      </div>
    </article>
  );
}
