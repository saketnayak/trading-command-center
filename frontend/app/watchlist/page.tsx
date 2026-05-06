"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopNav } from "@/components/layout/TopNav";
import {
  getWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  updateWatchlistItem,
  triggerWatchlistRun,
  getProviderModels,
} from "@/lib/api";
import type { WatchlistItem, AddWatchlistItemRequest } from "@/lib/types";

const ANALYSTS = ["market", "social", "news", "fundamentals", "technical"];
const LOCAL_PROVIDERS = ["ollama", "vllm"];
const PLACEHOLDERS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  google: "gemini-2.0-flash",
  ollama: "llama3",
  vllm: "mistralai/Mistral-7B-Instruct-v0.3",
};

const CRON_PRESETS = [
  { label: "Daily 9am", value: "0 9 * * *" },
  { label: "Daily 4pm", value: "0 16 * * *" },
  { label: "Weekly Mon 9am", value: "0 9 * * 1" },
  { label: "Weekly Fri 4pm", value: "0 16 * * 5" },
  { label: "Manual only", value: "" },
  { label: "Custom…", value: "__custom__" },
];

function CronLabel({ cron }: { cron: string | null }) {
  if (!cron) return <span className="text-slate-500 text-xs">Manual only</span>;
  const preset = CRON_PRESETS.find((p) => p.value === cron);
  return <span className="text-slate-300 text-xs">{preset?.label ?? cron}</span>;
}

function AddItemForm({ onAdd, isPending }: { onAdd: (req: AddWatchlistItemRequest) => void; isPending: boolean }) {
  const [ticker, setTicker] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [depth, setDepth] = useState<"quick" | "standard" | "deep">("standard");
  const [analysts, setAnalysts] = useState<string[]>(["market", "social", "news", "fundamentals", "technical"]);
  const [schedulePreset, setSchedulePreset] = useState("0 9 * * 1");
  const [customCron, setCustomCron] = useState("");

  const isLocal = LOCAL_PROVIDERS.includes(provider);
  const isCustom = schedulePreset === "__custom__";
  const finalCron = isCustom ? (customCron.trim() || null) : (schedulePreset || null);

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
      schedule_cron: finalCron,
    });
    setTicker("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Ticker */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Ticker</label>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="AAPL"
            className="bg-navy-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Provider */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="bg-navy-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          >
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="google">google</option>
            <option value="ollama">ollama (local)</option>
            <option value="vllm">vllm (local)</option>
          </select>
        </div>

        {/* Model */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Model</label>
          {modelsLoading ? (
            <select disabled className="bg-navy-900 border border-slate-700 text-slate-500 text-sm rounded-lg px-3 py-2">
              <option>Loading…</option>
            </select>
          ) : models.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="bg-navy-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
            >
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={PLACEHOLDERS[provider]}
              className="bg-navy-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
            />
          )}
        </div>

        {/* Depth */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Depth</label>
          <select
            value={depth}
            onChange={(e) => setDepth(e.target.value as "quick" | "standard" | "deep")}
            className="bg-navy-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          >
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
          </select>
        </div>
      </div>

      {/* Analysts */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">Analysts</label>
        <div className="flex flex-wrap gap-2">
          {ANALYSTS.map((a) => {
            const selected = analysts.includes(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleAnalyst(a)}
                className={`px-3 py-1 rounded border text-xs capitalize ${selected ? "bg-blue-700 text-white border-blue-600" : "bg-navy-900 text-slate-400 border-slate-700"}`}
              >
                {a}
              </button>
            );
          })}
        </div>
      </div>

      {/* Schedule */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Schedule</label>
          <select
            value={schedulePreset}
            onChange={(e) => setSchedulePreset(e.target.value)}
            className="bg-navy-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          >
            {CRON_PRESETS.map((p) => (
              <option key={p.label} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {isCustom && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Cron expression</label>
            <input
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="0 9 * * 1-5"
              className="bg-navy-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 w-44 focus:outline-none focus:border-blue-500 font-mono"
            />
            <p className="text-xs text-slate-500">min hour dom month dow</p>
          </div>
        )}

        <button
          onClick={handleAdd}
          disabled={!ticker || analysts.length === 0 || isPending}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg self-end"
        >
          {isPending ? "Adding…" : "Add to Watchlist"}
        </button>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onRemove,
  onToggle,
  onRunNow,
}: {
  item: WatchlistItem;
  onRemove: () => void;
  onToggle: () => void;
  onRunNow: () => void;
}) {
  return (
    <tr className="border-t border-slate-800 hover:bg-navy-700/40">
      <td className="px-4 py-3 font-semibold text-white">{item.ticker}</td>
      <td className="px-4 py-3 text-slate-400 text-sm">{item.llm_provider} / {item.llm_model}</td>
      <td className="px-4 py-3 text-slate-400 text-sm">{item.depth}</td>
      <td className="px-4 py-3 text-slate-400 text-xs">{item.analysts.join(", ")}</td>
      <td className="px-4 py-3"><CronLabel cron={item.schedule_cron} /></td>
      <td className="px-4 py-3 text-slate-500 text-xs">
        {item.last_run_at ? new Date(item.last_run_at).toLocaleDateString() : "Never"}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full ${item.enabled ? "bg-green-900/40 text-green-400" : "bg-slate-800 text-slate-500"}`}>
          {item.enabled ? "Active" : "Paused"}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button onClick={onRunNow} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 border border-blue-800 rounded">
            Run now
          </button>
          <button onClick={onToggle} className="text-xs text-slate-400 hover:text-slate-300 px-2 py-1 border border-slate-700 rounded">
            {item.enabled ? "Pause" : "Resume"}
          </button>
          <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-900 rounded">
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function WatchlistPage() {
  const qc = useQueryClient();

  const { data: watchlist, isLoading } = useQuery({
    queryKey: ["watchlist"],
    queryFn: getWatchlist,
  });

  const addMutation = useMutation({
    mutationFn: (req: AddWatchlistItemRequest) => addWatchlistItem(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const removeMutation = useMutation({
    mutationFn: removeWatchlistItem,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateWatchlistItem(id, { enabled }),
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

  return (
    <div className="min-h-screen bg-navy-900">
      <TopNav />
      <main className="p-6 max-w-6xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/runs" className="text-blue-400 hover:underline text-sm">← Back to History</Link>
          <h1 className="text-lg font-semibold text-white">Watchlist</h1>
        </div>

        <div className="bg-navy-800 border border-slate-700 rounded-xl p-5">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-4">Add Ticker</p>
          <AddItemForm onAdd={(req) => addMutation.mutate(req)} isPending={addMutation.isPending} />
          {addMutation.error && (
            <p className="text-red-400 text-sm mt-3">{String(addMutation.error)}</p>
          )}
        </div>

        {isLoading && <div className="text-slate-400 text-sm">Loading watchlist…</div>}

        {watchlist && (
          <div className="bg-navy-800 border border-slate-700 rounded-xl overflow-hidden">
            {watchlist.items.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-10">
                No tickers yet. Add one above to start tracking.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-navy-900">
                  <tr>
                    {["Ticker", "Model", "Depth", "Analysts", "Schedule", "Last Run", "Status", "Actions"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs text-slate-400 font-semibold uppercase">{h}</th>
                    ))}
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
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
