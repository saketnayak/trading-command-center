"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Star, X } from "lucide-react";
import { addWatchlistItem, getWatchlist, getProviderModels } from "@/lib/api";
import { isCrypto } from "@/lib/asset";
import { IconButton } from "@/components/ui/IconButton";

interface WatchDraft {
  llm_provider: string;
  llm_model: string;
  depth: string;
}

const PROVIDERS = ["openai", "anthropic", "google", "groq", "ionos", "ollama", "vllm"];
const DEPTHS = ["quick", "standard", "deep"] as const;

export type { WatchDraft };

export function WatchButton({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
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
          ? ["market", "social", "news"]
          : ["market", "social", "news", "fundamentals"],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      setOpen(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  if (watched || success) {
    if (compact) {
      return (
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-yellow-400"
          title="Already on watchlist"
          aria-label={`${ticker} is already on watchlist`}
        >
          <Star className="h-4 w-4 fill-current" aria-hidden="true" />
        </span>
      );
    }

    return (
      <span className="text-xs text-yellow-400 cursor-default" title="Already on watchlist">
        ★ Watching
      </span>
    );
  }

  if (!open) {
    if (compact) {
      return (
        <IconButton
          icon={Star}
          label={`Add ${ticker} to watchlist`}
          title="Add to watchlist"
          tone="warning"
          onClick={() => setOpen(true)}
        />
      );
    }

    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-muted hover:text-yellow-400 transition-colors"
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
        className="bg-input border border-input-border rounded-sm px-1.5 py-0.5 text-xs text-fg focus:outline-hidden"
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <select
        value={draft.llm_model}
        onChange={(e) => setDraft((d) => ({ ...d, llm_model: e.target.value }))}
        className="bg-input border border-input-border rounded-sm px-1.5 py-0.5 text-xs text-fg focus:outline-hidden max-w-[140px]"
      >
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select
        value={draft.depth}
        onChange={(e) => setDraft((d) => ({ ...d, depth: e.target.value }))}
        className="bg-input border border-input-border rounded-sm px-1.5 py-0.5 text-xs text-fg focus:outline-hidden"
      >
        {DEPTHS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <button
        onClick={() => addMutation.mutate()}
        disabled={addMutation.isPending}
        aria-label={`Add ${ticker} to watchlist`}
        title="Add"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-green-400 hover:text-green-300 hover:bg-green-950/30 disabled:opacity-50"
      >
        {addMutation.isPending ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      <button
        onClick={() => setOpen(false)}
        aria-label="Cancel adding to watchlist"
        title="Cancel"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted hover:text-fg-secondary hover:bg-muted-surface"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
