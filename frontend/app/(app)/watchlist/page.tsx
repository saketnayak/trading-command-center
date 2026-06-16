"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Trash2, CalendarClock } from "lucide-react";
import {
  getWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  updateWatchlistItem,
  triggerWatchlistRun,
  getProviderModels,
} from "@/lib/api";
import { TickerLabel } from "@/components/ui/TickerLabel";
import { useTickerMetadata } from "@/lib/useTickerMetadata";
import type { WatchlistItem, AddWatchlistItemRequest, TickerMetadata } from "@/lib/types";
import { IconButton } from "@/components/ui/IconButton";
import { AnalystIcons, LanguageFlag } from "@/components/runs/RunContextIcons";
import { DEFAULT_RESPONSE_LANGUAGE, RESPONSE_LANGUAGE_OPTIONS } from "@/lib/responseLanguage";
import type { ResponseLanguage } from "@/lib/responseLanguage";
import {
  DEFAULT_WATCHLIST_CRON,
  WatchlistScheduleBuilder,
} from "@/components/watchlist/WatchlistScheduleBuilder";
import { CronLabel } from "@/components/watchlist/CronLabel";

import { ANALYST_OPTIONS, DEFAULT_ANALYSTS } from "@/lib/analystReports";

const ANALYSTS = ANALYST_OPTIONS;
const LOCAL_PROVIDERS = ["ollama", "vllm"];
const PLACEHOLDERS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  ionos: "openai/gpt-oss-120b",
  ollama: "llama3",
  vllm: "mistralai/Mistral-7B-Instruct-v0.3",
};

// ─── Add Item Form ────────────────────────────────────────────────────────────

function AddItemForm({ onAdd, isPending }: { onAdd: (req: AddWatchlistItemRequest) => void; isPending: boolean }) {
  const [ticker, setTicker] = useState("");
  const [provider, setProvider] = useState("ionos");
  const [model, setModel] = useState("");
  const [depth, setDepth] = useState<"quick" | "standard" | "deep">("standard");
  const [analysts, setAnalysts] = useState<string[]>(DEFAULT_ANALYSTS);
  const [responseLanguage, setResponseLanguage] = useState<ResponseLanguage>(DEFAULT_RESPONSE_LANGUAGE);
  const [cron, setCron] = useState<string | null>(DEFAULT_WATCHLIST_CRON);

  const isLocal = LOCAL_PROVIDERS.includes(provider);

  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ["models", provider],
    queryFn: () => getProviderModels(provider),
    retry: false,
  });

  useEffect(() => { setModel(""); }, [provider]);
  useEffect(() => {
    if (isLocal && models.length > 0 && !model) setModel(models[0]);
  }, [models, isLocal, model]);

  function toggleAnalyst(name: string) {
    setAnalysts((prev) => prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name]);
  }

  function handleAdd() {
    if (!ticker || analysts.length === 0) return;
    onAdd({
      ticker,
      llm_provider: provider,
      llm_model: model || PLACEHOLDERS[provider] || "",
      depth,
      analysts,
      response_language: responseLanguage,
      schedule_cron: cron,
    });
    setTicker("");
  }

  const inputCls = "bg-page border border-input-border text-fg text-sm rounded-lg px-3 py-2 focus:outline-hidden focus:border-blue-500";

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="AAPL" className={inputCls} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls}>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="google">google</option>
            <option value="groq">groq</option>
            <option value="ionos">ionos</option>
            <option value="ollama">ollama (local)</option>
            <option value="vllm">vllm (local)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Model</label>
          {modelsLoading ? (
            <select disabled className={`${inputCls} text-muted`}><option>Loading…</option></select>
          ) : models.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={PLACEHOLDERS[provider]} className={inputCls} />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Depth</label>
          <select value={depth} onChange={(e) => setDepth(e.target.value as "quick" | "standard" | "deep")} className={inputCls}>
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Language</label>
          <select value={responseLanguage} onChange={(e) => setResponseLanguage(e.target.value as ResponseLanguage)} className={inputCls}>
            {RESPONSE_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Analysts</label>
        <div className="flex flex-wrap gap-2">
          {ANALYSTS.map((a) => {
            const sel = analysts.includes(a);
            return (
              <button key={a} type="button" onClick={() => toggleAnalyst(a)}
                className={`px-3 py-1 rounded-sm border text-xs capitalize ${sel ? "bg-blue-700 text-fg border-blue-600" : "bg-page text-muted border-input-border"}`}>
                {a}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-xs text-muted uppercase tracking-wide font-semibold mb-3">Schedule</p>
        <WatchlistScheduleBuilder
          cron={cron}
          onCronChange={setCron}
        />
      </div>

      <button
        onClick={handleAdd}
        disabled={!ticker || analysts.length === 0 || isPending}
        className="self-start bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-fg text-sm font-medium px-5 py-2 rounded-lg"
      >
        {isPending ? "Adding…" : "Add to Watchlist"}
      </button>
    </div>
  );
}

// ─── Item Row ─────────────────────────────────────────────────────────────────

function ItemRow({ item, onRemove, onToggle, onRunNow, onSaveSchedule, metadata }: {
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
    <tr className="border-t border-border hover:bg-muted-surface/40">
      <td className="px-4 py-3">
        <TickerLabel ticker={item.ticker} metadata={metadata}>
          <span className="font-semibold text-fg">{item.ticker}</span>
        </TickerLabel>
      </td>
      <td className="hidden lg:table-cell px-4 py-3 text-muted text-sm">{item.llm_provider} / {item.llm_model}</td>
      <td className="hidden lg:table-cell px-4 py-3 text-muted text-sm">{item.depth}</td>
      <td className="hidden lg:table-cell px-4 py-3">
        <LanguageFlag value={item.response_language} />
      </td>
      <td className="hidden lg:table-cell px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <AnalystIcons analysts={item.analysts} />
        </div>
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
        <span className={`text-xs px-2 py-0.5 rounded-full ${item.enabled ? "bg-green-900/40 text-green-400" : "bg-input text-muted"}`}>
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
      <tr className="border-t border-border bg-page/40">
        <td colSpan={9} className="px-4 py-4">
          <div className="flex flex-col gap-3 max-w-4xl">
            <p className="text-xs text-muted uppercase tracking-wide font-semibold">Edit schedule for {item.ticker}</p>
            <WatchlistScheduleBuilder
              key={`${item.id}-${scheduleEditorKey}`}
              instanceKey={`${item.id}-${item.schedule_cron ?? "manual"}-${scheduleEditorKey}`}
              cron={draftCron}
              onCronChange={setDraftCron}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onSaveSchedule(draftCron);
                  setEditingSchedule(false);
                }}
                className="bg-blue-600 hover:bg-blue-500 text-fg text-xs font-medium px-3 py-1.5 rounded-lg"
              >
                Save schedule
              </button>
              <button
                type="button"
                onClick={() => setEditingSchedule(false)}
                className="text-xs text-muted hover:text-fg-secondary px-3 py-1.5 border border-input-border rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const qc = useQueryClient();

  const [showAddTicker, setShowAddTicker] = useState(true);

  const { data: watchlist, isLoading } = useQuery({ queryKey: ["watchlist"], queryFn: getWatchlist });
  const { data: tickerMetadata = {} } = useTickerMetadata(
    watchlist?.items.map((item) => item.ticker) ?? [],
    { enabled: !!watchlist && watchlist.items.length > 0 }
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

  return (
    <main className="px-4 py-4 sm:p-6 max-w-6xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/runs" className="text-blue-400 hover:underline text-sm">← Back to History</Link>
          <h1 className="text-lg font-semibold text-fg">Watchlist</h1>
        </div>

        <div className="bg-elevated border border-input-border rounded-xl p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <p className="text-xs text-muted uppercase tracking-wide font-semibold">
              Add Ticker
            </p>
        
            <button
              type="button"
              onClick={() => setShowAddTicker((v) =>!v)}
              className="text-xs text-muted hover:text-fg-secondary px-2 py-1 border border-input-border rounded-sm"
            >
              {showAddTicker? "Hide": "Show"}
            </button>
          </div>
        
          {showAddTicker && (
            <>
              <AddItemForm onAdd={(req) => addMutation.mutate(req)} isPending={addMutation.isPending} />
              {addMutation.error && (
                <p className="text-red-400 text-sm mt-3">{String(addMutation.error)}</p>
              )}
            </>
          )}
        </div>

        {isLoading && <div className="text-muted text-sm">Loading watchlist…</div>}

        {watchlist && (
          <div className="bg-elevated border border-input-border rounded-xl overflow-hidden">
            {watchlist.items.length === 0 ? (
              <p className="text-muted text-sm text-center py-10">No tickers yet. Add one above to start tracking.</p>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm lg:min-w-[720px]">
                <thead className="bg-page">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Ticker</th>
                    <th className="hidden lg:table-cell px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Model</th>
                    <th className="hidden lg:table-cell px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Depth</th>
                    <th className="hidden lg:table-cell px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Language</th>
                    <th className="hidden lg:table-cell px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Analysts</th>
                    <th className="hidden lg:table-cell px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Schedule</th>
                    <th className="px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Last Run</th>
                    <th className="px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Actions</th>
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
              </table></div>
            )}
          </div>
        )}
      </main>
  );
}
