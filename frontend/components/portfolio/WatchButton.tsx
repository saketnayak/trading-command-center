"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { addWatchlistItem, getWatchlist, getProviderModels } from "@/lib/api";
import { isCrypto } from "@/lib/asset";

interface WatchDraft {
  llm_provider: string;
  llm_model: string;
  depth: string;
}

const PROVIDERS = ["openai", "anthropic", "google", "groq", "ollama", "vllm"];
const DEPTHS = ["quick", "standard", "deep"] as const;

export type { WatchDraft };

export function WatchButton({ ticker }: { ticker: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WatchDraft>({ llm_provider: "openai", llm_model: "", depth: "standard" });
  const [success, setSuccess] = useState(false);

  const { data: watchlist } = useQuery({ queryKey: ["watchlist"], queryFn: getWatchlist });
  const watched = watchlist?.items.some((i) => i.ticker.toUpperCase() === ticker.toUpperCase()) ?? false;

  const { data: models = [] } = useQuery({
    queryKey: ["provider-models", draft.llm_provider],
    queryFn: () => getProviderModels(draft.llm_provider),
    enabled: open,
  });

  useEffect(() => {
    if (models.length > 0 && !draft.llm_model) {
      setDraft((d) => ({ ...d, llm_model: models[0] }));
    }
  }, [models, draft.llm_model]);

  const addMutation = useMutation({
    mutationFn: () =>
      addWatchlistItem({
        ticker,
        llm_provider: draft.llm_provider,
        llm_model: draft.llm_model || (models[0] ?? ""),
        depth: draft.depth,
        analysts: isCrypto(ticker)
          ? ["market", "social", "news", "technical"]
          : ["market", "social", "news", "fundamentals", "technical"],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      setOpen(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  if (watched || success) {
    return (
      <span className="text-xs text-yellow-400 cursor-default" title="Already on watchlist">
        ★ Watching
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-slate-400 hover:text-yellow-400 transition-colors"
        title="Add to watchlist"
      >
        Watch
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <select
        value={draft.llm_provider}
        onChange={(e) => setDraft((d) => ({ ...d, llm_provider: e.target.value, llm_model: "" }))}
        className="bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-200 focus:outline-none"
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <select
        value={draft.llm_model}
        onChange={(e) => setDraft((d) => ({ ...d, llm_model: e.target.value }))}
        className="bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-200 focus:outline-none max-w-[140px]"
      >
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select
        value={draft.depth}
        onChange={(e) => setDraft((d) => ({ ...d, depth: e.target.value }))}
        className="bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-200 focus:outline-none"
      >
        {DEPTHS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <button
        onClick={() => addMutation.mutate()}
        disabled={addMutation.isPending}
        className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
      >
        {addMutation.isPending ? "Adding…" : "Add"}
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
    </div>
  );
}
