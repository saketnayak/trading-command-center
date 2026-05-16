"use client";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  getSectorGaps,
  discoverStocks,
  type SectorGap,
  type StockRecommendation,
} from "@/lib/api";
import { WatchButton } from "@/components/portfolio/WatchButton";

type TagFilter = "All" | "Gap Fill" | "Trending" | "Mover";
const TAG_COLORS: Record<string, string> = {
  "Gap Fill": "bg-emerald-900 text-emerald-300 border border-emerald-700",
  Trending:   "bg-blue-900 text-blue-300 border border-blue-700",
  Mover:      "bg-amber-900 text-amber-300 border border-amber-700",
};

export function DiscoverPanel({ portfolioId }: { portfolioId: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<TagFilter>("All");

  const { data: gaps = [], isLoading: gapsLoading } = useQuery({
    queryKey: ["sector-gaps", portfolioId],
    queryFn: () => getSectorGaps(portfolioId),
    staleTime: 300_000,
  });

  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  const discoverMutation = useMutation({
    mutationFn: () => discoverStocks(portfolioId),
    onSuccess: (data) => {
      setRecommendations(data.recommendations);
      setHasLoaded(true);
    },
  });

  const filtered = filter === "All"
    ? recommendations
    : recommendations.filter((r) => r.tag === filter);

  const maxWeight = Math.max(...gaps.map((g) => Math.max(g.your_weight, g.sp500_weight)), 0.01);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-4">
      {/* Left: Sector Gap Analysis */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-300">
          Sector Gap Analysis
          <span className="ml-2 text-xs font-normal text-slate-500">your portfolio vs S&P 500</span>
        </h3>
        {gapsLoading ? (
          <p className="text-xs text-slate-500 italic">Loading…</p>
        ) : gaps.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            Add a Finnhub key in Settings to see sector analysis.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {gaps.map((g) => (
              <SectorRow key={g.sector} gap={g} maxWeight={maxWeight} />
            ))}
          </div>
        )}
      </div>

      {/* Right: AI Recommendations */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300">AI Recommendations</h3>
          <button
            onClick={() => discoverMutation.mutate()}
            disabled={discoverMutation.isPending}
            className="text-xs font-semibold px-3 py-1 rounded bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white transition-colors"
          >
            {discoverMutation.isPending ? "Generating…" : hasLoaded ? "↺ Refresh" : "Generate"}
          </button>
        </div>

        {hasLoaded && (
          <div className="flex gap-1.5 flex-wrap">
            {(["All", "Gap Fill", "Trending", "Mover"] as TagFilter[]).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  filter === t
                    ? "bg-violet-800 text-violet-200 border-violet-600"
                    : "bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {discoverMutation.isError && (
          <p className="text-xs text-red-400">
            Failed to generate recommendations. Check your LLM key in Settings.
          </p>
        )}

        {!hasLoaded && !discoverMutation.isPending && (
          <p className="text-xs text-slate-500 italic">
            Click Generate to get AI-curated stock recommendations based on your portfolio gaps and today&apos;s market activity.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {filtered.map((rec) => (
            <RecommendationCard
              key={rec.ticker}
              rec={rec}
              onAnalyze={() => router.push(`/runs/new?ticker=${encodeURIComponent(rec.ticker)}`)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SectorRow({ gap, maxWeight }: { gap: SectorGap; maxWeight: number }) {
  const isUnder = gap.delta < -0.05;
  const isOver = gap.delta > 0.05;
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5 text-xs">
        <span className="text-slate-300">{gap.sector}</span>
        <div className="flex gap-3">
          <span className="text-blue-400 font-semibold">{(gap.your_weight * 100).toFixed(1)}%</span>
          <span className="text-slate-500">{(gap.sp500_weight * 100).toFixed(1)}%</span>
          <span className={isUnder ? "text-emerald-400 font-semibold" : isOver ? "text-red-400 font-semibold" : "text-slate-500"}>
            {gap.delta >= 0 ? "+" : ""}{(gap.delta * 100).toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="h-1.5 bg-slate-800 rounded relative">
        <div
          className="h-full bg-blue-500 rounded"
          style={{ width: `${(gap.your_weight / maxWeight) * 100}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-slate-500"
          style={{ left: `${(gap.sp500_weight / maxWeight) * 100}%` }}
        />
      </div>
    </div>
  );
}

function RecommendationCard({
  rec,
  onAnalyze,
}: {
  rec: StockRecommendation;
  onAnalyze: () => void;
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-slate-100 font-bold text-sm">{rec.ticker}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${TAG_COLORS[rec.tag] ?? "bg-slate-700 text-slate-300"}`}>
            {rec.tag}
          </span>
          {rec.sector && (
            <span className="text-xs text-slate-500">{rec.sector}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onAnalyze}
            className="text-xs font-semibold px-2 py-0.5 rounded bg-violet-700 hover:bg-violet-600 text-white transition-colors"
          >
            ⚡ Analyze
          </button>
          <WatchButton ticker={rec.ticker} />
        </div>
      </div>
      {rec.reason && (
        <p className="text-xs text-slate-400">{rec.reason}</p>
      )}
    </div>
  );
}
