"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Trash2, CalendarClock, ListPlus } from "lucide-react";
import {
  getWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  updateWatchlistItem,
  triggerWatchlistRun,
} from "@/lib/api";
import { TickerLabel } from "@/components/ui/TickerLabel";
import { useTickerMetadata } from "@/lib/useTickerMetadata";
import type { WatchlistItem, AddWatchlistItemRequest, TickerMetadata } from "@/lib/types";
import { IconButton } from "@/components/ui/IconButton";
import { AnalystIcons, LanguageFlag } from "@/components/runs/RunContextIcons";
import { CronLabel } from "@/components/watchlist/CronLabel";
import { WatchlistItemCard } from "@/components/watchlist/WatchlistItemCard";
import { AddWatchlistItemForm } from "@/components/watchlist/AddWatchlistItemForm";
import { WatchlistScheduleEditor } from "@/components/watchlist/WatchlistScheduleEditor";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, PageTitle } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";

function ItemRow({
  item,
  onRemove,
  onToggle,
  onRunNow,
  onSaveSchedule,
  metadata,
}: {
  item: WatchlistItem;
  onRemove: () => void;
  onToggle: () => void;
  onRunNow: () => void;
  onSaveSchedule: (cron: string | null) => void;
  metadata?: TickerMetadata;
}) {
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [draftCron, setDraftCron] = useState<string | null>(item.schedule_cron);
  const [scheduleEditorKey, setScheduleEditorKey] = useState(0);

  return (
    <>
      <tr className="border-t border-border hover:bg-muted-surface/40 hidden md:table-row">
        <td className="px-4 py-3">
          <TickerLabel ticker={item.ticker} metadata={metadata} />
        </td>
        <td className="hidden lg:table-cell px-4 py-3 text-muted text-sm">
          {item.llm_provider} / {item.llm_model}
        </td>
        <td className="hidden lg:table-cell px-4 py-3 text-muted text-sm">{item.depth}</td>
        <td className="hidden lg:table-cell px-4 py-3">
          <LanguageFlag value={item.response_language} />
        </td>
        <td className="hidden lg:table-cell px-4 py-3">
          <AnalystIcons analysts={item.analysts} />
        </td>
        <td className="hidden lg:table-cell px-4 py-3">
          <CronLabel cron={item.schedule_cron} nextRunAt={item.next_run_at} />
        </td>
        <td className="px-4 py-3 text-xs">
          {item.last_run_at && item.last_run_id ? (
            <Link href={`/runs/${item.last_run_id}`} className="text-blue-400 hover:underline">
              {new Date(item.last_run_at).toLocaleDateString()}
            </Link>
          ) : (
            <span className="text-muted">Never</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${item.enabled ? "bg-green-900/40 text-green-400" : "bg-input text-muted"}`}
          >
            {item.enabled ? "Active" : "Paused"}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-1.5">
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
        </td>
      </tr>
      {editingSchedule && (
        <tr className="border-t border-border bg-page/40 hidden md:table-row">
          <td colSpan={9} className="px-4 py-4">
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
          </td>
        </tr>
      )}
    </>
  );
}

export default function WatchlistPage() {
  const qc = useQueryClient();

  const { data: watchlist, isLoading } = useQuery({ queryKey: ["watchlist"], queryFn: getWatchlist });
  const { data: tickerMetadata = {} } = useTickerMetadata(
    watchlist?.items.map((item) => item.ticker) ?? [],
    { enabled: !!watchlist && watchlist.items.length > 0 },
  );

  const addMutation = useMutation({
    mutationFn: (req: AddWatchlistItemRequest) => addWatchlistItem(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const removeMutation = useMutation({
    mutationFn: removeWatchlistItem,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateWatchlistItem(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const runNowMutation = useMutation({
    mutationFn: triggerWatchlistRun,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      window.open(`/runs/${data.run_id}/live`, "_blank");
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: ({ id, schedule_cron }: { id: string; schedule_cron: string | null }) =>
      updateWatchlistItem(id, { schedule_cron }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      qc.invalidateQueries({ queryKey: ["watchlist-scheduler"] });
    },
  });

  function scrollToAddForm() {
    document.getElementById("watchlist-add-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <PageShell gap="6">
      <PageHeader
        title={<PageTitle>Watchlist</PageTitle>}
        description="Schedule recurring AI analyses or run tickers on demand."
      />

      <section
        id="watchlist-add-form"
        className="rounded-lg border border-border bg-surface p-4 sm:p-5"
      >
        <h2 className="text-sm font-medium text-fg mb-4">Add ticker</h2>
        <AddWatchlistItemForm onAdd={(req) => addMutation.mutate(req)} isPending={addMutation.isPending} />
        {addMutation.error && (
          <p className="text-red-400 text-sm mt-3">{String(addMutation.error)}</p>
        )}
      </section>

      {isLoading && <div className="text-muted text-sm">Loading watchlist…</div>}

      {watchlist && (
        <section className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <h2 className="text-sm font-medium text-fg">
              Scheduled tickers
              {watchlist.items.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted">{watchlist.items.length}</span>
              )}
            </h2>
          </div>

          {watchlist.items.length === 0 ? (
            <EmptyState
              icon={ListPlus}
              title="No tickers on your watchlist"
              description="Add a ticker above to schedule recurring AI analyses."
              action={{ label: "Add ticker", onClick: scrollToAddForm }}
              className="border-0 rounded-none bg-transparent"
            />
          ) : (
            <>
              <div className="space-y-3 p-3 md:hidden">
                {watchlist.items.map((item) => (
                  <WatchlistItemCard
                    key={item.id}
                    item={item}
                    metadata={tickerMetadata[item.ticker.toUpperCase()]}
                    onRemove={() => removeMutation.mutate(item.id)}
                    onToggle={() => toggleMutation.mutate({ id: item.id, enabled: !item.enabled })}
                    onRunNow={() => runNowMutation.mutate(item.id)}
                    onSaveSchedule={(schedule_cron) =>
                      scheduleMutation.mutate({ id: item.id, schedule_cron })
                    }
                  />
                ))}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm lg:min-w-[720px]">
                  <thead className="bg-page/60 text-xs text-muted uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Ticker</th>
                      <th className="hidden lg:table-cell px-4 py-3 text-left font-semibold">Model</th>
                      <th className="hidden lg:table-cell px-4 py-3 text-left font-semibold">Depth</th>
                      <th className="hidden lg:table-cell px-4 py-3 text-left font-semibold">Language</th>
                      <th className="hidden lg:table-cell px-4 py-3 text-left font-semibold">Analysts</th>
                      <th className="hidden lg:table-cell px-4 py-3 text-left font-semibold">Schedule</th>
                      <th className="px-4 py-3 text-left font-semibold">Last run</th>
                      <th className="px-4 py-3 text-left font-semibold">Status</th>
                      <th className="px-4 py-3 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchlist.items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        onRemove={() => removeMutation.mutate(item.id)}
                        onToggle={() => toggleMutation.mutate({ id: item.id, enabled: !item.enabled })}
                        onRunNow={() => runNowMutation.mutate(item.id)}
                        onSaveSchedule={(schedule_cron) =>
                          scheduleMutation.mutate({ id: item.id, schedule_cron })
                        }
                        metadata={tickerMetadata[item.ticker.toUpperCase()]}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </PageShell>
  );
}
