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
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3",
  vllm: "mistralai/Mistral-7B-Instruct-v0.3",
};

const DAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

type Frequency = "daily" | "weekdays" | "weekly" | "custom_days" | "manual";

function buildCron(freq: Frequency, hour: number, minute: number, days: number[]): string | null {
  if (freq === "manual") return null;
  const h = hour;
  const m = minute;
  if (freq === "daily") return `${m} ${h} * * *`;
  if (freq === "weekdays") return `${m} ${h} * * 1-5`;
  if (freq === "weekly") return `${m} ${h} * * ${days[0] ?? 1}`;
  if (freq === "custom_days") {
    if (days.length === 0) return null;
    return `${m} ${h} * * ${days.sort((a, b) => a - b).join(",")}`;
  }
  return null;
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function fmtHour(h: number) {
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${ampm}`;
}
function fmtTime(h: number, m: number) {
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ampm}`;
}

// ─── Schedule Builder ────────────────────────────────────────────────────────

interface ScheduleBuilderProps {
  onChange: (cron: string | null) => void;
}

function ScheduleBuilder({ onChange }: ScheduleBuilderProps) {
  const [freq, setFreq] = useState<Frequency>("weekly");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [selectedDays, setSelectedDays] = useState<number[]>([1]); // Mon default

  const showDayPicker = freq === "weekly" || freq === "custom_days";
  const multiDay = freq === "custom_days";

  const cron = buildCron(freq, hour, minute, selectedDays);

  useEffect(() => { onChange(cron); }, [freq, hour, minute, selectedDays]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDay(val: number) {
    if (multiDay) {
      setSelectedDays((prev) =>
        prev.includes(val)
          ? prev.length > 1 ? prev.filter((d) => d !== val) : prev
          : [...prev, val]
      );
    } else {
      setSelectedDays([val]);
    }
  }

  const selectCls = "bg-navy-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500";

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: frequency + time */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Frequency</label>
          <select value={freq} onChange={(e) => setFreq(e.target.value as Frequency)} className={selectCls}>
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays (Mon – Fri)</option>
            <option value="weekly">Weekly (pick one day)</option>
            <option value="custom_days">Custom days</option>
            <option value="manual">Manual only</option>
          </select>
        </div>

        {freq !== "manual" && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Hour</label>
              <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className={selectCls}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>{fmtHour(h)}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Minute</label>
              <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className={selectCls}>
                {MINUTES.map((m) => (
                  <option key={m} value={m}>:{pad(m)}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* Row 2: day picker */}
      {showDayPicker && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">
            {multiDay ? "Days (select multiple)" : "Day"}
          </label>
          <div className="flex gap-2">
            {DAYS.map(({ label, value }) => {
              const active = selectedDays.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleDay(value)}
                  className={`w-10 h-9 rounded-lg text-xs font-semibold border transition-colors ${
                    active
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-navy-900 border-slate-700 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cron preview */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-slate-500">Schedule:</span>
        <code className="text-xs text-blue-300 bg-navy-900 border border-slate-800 px-2 py-0.5 rounded">
          {cron ?? "manual trigger"}
        </code>
        {cron && (
          <span className="text-xs text-slate-500">
            {freq === "daily" && `Runs every day at ${fmtTime(hour, minute)}`}
            {freq === "weekdays" && `Runs Mon–Fri at ${fmtTime(hour, minute)}`}
            {freq === "weekly" && `Runs every ${DAYS.find((d) => d.value === selectedDays[0])?.label ?? ""} at ${fmtTime(hour, minute)}`}
            {freq === "custom_days" && `Runs on ${selectedDays.map((v) => DAYS.find((d) => d.value === v)?.label).join(", ")} at ${fmtTime(hour, minute)}`}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── CronLabel (table display) ───────────────────────────────────────────────

function CronLabel({ cron }: { cron: string | null }) {
  if (!cron) return <span className="text-slate-500 text-xs">Manual only</span>;
  // try to produce a human label from known patterns
  const daily = cron.match(/^(\d+) (\d+) \* \* \*$/);
  if (daily) return <span className="text-slate-300 text-xs">Daily {fmtTime(Number(daily[2]), Number(daily[1]))}</span>;
  const wdays = cron.match(/^(\d+) (\d+) \* \* 1-5$/);
  if (wdays) return <span className="text-slate-300 text-xs">Weekdays {fmtTime(Number(wdays[2]), Number(wdays[1]))}</span>;
  const weekly = cron.match(/^(\d+) (\d+) \* \* (\d)$/);
  if (weekly) {
    const day = DAYS.find((d) => d.value === Number(weekly[3]));
    return <span className="text-slate-300 text-xs">{day?.label ?? `Day ${weekly[3]}`} {fmtTime(Number(weekly[2]), Number(weekly[1]))}</span>;
  }
  return <span className="text-slate-300 text-xs font-mono">{cron}</span>;
}

// ─── Add Item Form ────────────────────────────────────────────────────────────

function AddItemForm({ onAdd, isPending }: { onAdd: (req: AddWatchlistItemRequest) => void; isPending: boolean }) {
  const [ticker, setTicker] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [depth, setDepth] = useState<"quick" | "standard" | "deep">("standard");
  const [analysts, setAnalysts] = useState<string[]>(["market", "social", "news", "fundamentals", "technical"]);
  const [cron, setCron] = useState<string | null>("0 9 * * 1");

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
      schedule_cron: cron,
    });
    setTicker("");
  }

  const inputCls = "bg-navy-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500";

  return (
    <div className="flex flex-col gap-5">
      {/* Row 1: ticker + provider + model + depth */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="AAPL" className={inputCls} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls}>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="google">google</option>
            <option value="groq">groq</option>
            <option value="ollama">ollama (local)</option>
            <option value="vllm">vllm (local)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Model</label>
          {modelsLoading ? (
            <select disabled className={`${inputCls} text-slate-500`}><option>Loading…</option></select>
          ) : models.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={PLACEHOLDERS[provider]} className={inputCls} />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Depth</label>
          <select value={depth} onChange={(e) => setDepth(e.target.value as "quick" | "standard" | "deep")} className={inputCls}>
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
          </select>
        </div>
      </div>

      {/* Row 2: analysts */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">Analysts</label>
        <div className="flex flex-wrap gap-2">
          {ANALYSTS.map((a) => {
            const sel = analysts.includes(a);
            return (
              <button key={a} type="button" onClick={() => toggleAnalyst(a)}
                className={`px-3 py-1 rounded border text-xs capitalize ${sel ? "bg-blue-700 text-white border-blue-600" : "bg-navy-900 text-slate-400 border-slate-700"}`}>
                {a}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 3: schedule builder */}
      <div className="border-t border-slate-800 pt-4">
        <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-3">Schedule</p>
        <ScheduleBuilder onChange={setCron} />
      </div>

      {/* Add button */}
      <button
        onClick={handleAdd}
        disabled={!ticker || analysts.length === 0 || isPending}
        className="self-start bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg"
      >
        {isPending ? "Adding…" : "Add to Watchlist"}
      </button>
    </div>
  );
}

// ─── Item Row ─────────────────────────────────────────────────────────────────

function ItemRow({ item, onRemove, onToggle, onRunNow }: {
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
      <td className="px-4 py-3 text-xs">
        {item.last_run_at && item.last_run_id ? (
          <Link href={`/runs/${item.last_run_id}`} className="text-blue-400 hover:underline">
            {new Date(item.last_run_at).toLocaleDateString()}
          </Link>
        ) : (
          <span className="text-slate-500">Never</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full ${item.enabled ? "bg-green-900/40 text-green-400" : "bg-slate-800 text-slate-500"}`}>
          {item.enabled ? "Active" : "Paused"}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button onClick={onRunNow} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 border border-blue-800 rounded">Run now</button>
          <button onClick={onToggle} className="text-xs text-slate-400 hover:text-slate-300 px-2 py-1 border border-slate-700 rounded">
            {item.enabled ? "Pause" : "Resume"}
          </button>
          <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-900 rounded">Remove</button>
        </div>
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const qc = useQueryClient();

  const { data: watchlist, isLoading } = useQuery({ queryKey: ["watchlist"], queryFn: getWatchlist });

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
          {addMutation.error && <p className="text-red-400 text-sm mt-3">{String(addMutation.error)}</p>}
        </div>

        {isLoading && <div className="text-slate-400 text-sm">Loading watchlist…</div>}

        {watchlist && (
          <div className="bg-navy-800 border border-slate-700 rounded-xl overflow-hidden">
            {watchlist.items.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-10">No tickers yet. Add one above to start tracking.</p>
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
