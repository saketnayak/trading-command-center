"use client";
import type { PortfolioHolding, FundamentalsData } from "@/lib/types";

interface Props {
  holdings: PortfolioHolding[];
  onAnalyzeStale?: () => void;
  fundamentals?: Record<string, FundamentalsData>;
}

const STALE_DAYS = 7;

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export function PortfolioStatsBar({ holdings, onAnalyzeStale, fundamentals }: Props) {
  if (holdings.length === 0) return null;

  const withPrice = holdings.filter((h) => h.unrealized_pnl_pct != null);
  const sorted = [...withPrice].sort((a, b) => (b.unrealized_pnl_pct ?? 0) - (a.unrealized_pnl_pct ?? 0));
  const best = sorted[0] ?? null;
  const worst = sorted[sorted.length - 1] ?? null;

  const staleCount = holdings.filter((h) => {
    if (!h.last_run) return true;
    return daysAgo(h.last_run.analysis_date) > STALE_DAYS;
  }).length;

  const buyCount = holdings.filter((h) => h.last_run?.verdict?.toLowerCase() === "buy").length;
  const sellCount = holdings.filter((h) => h.last_run?.verdict?.toLowerCase() === "sell").length;

  const undervaluedByPeg = fundamentals
    ? holdings.filter((h) => {
        const f = fundamentals[h.ticker];
        return f?.peg_ratio != null && f.peg_ratio < 1.0;
      }).length
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-slate-800/40 border border-slate-700/60 rounded-lg text-xs">
      {best && (
        <Stat
          label="Best performer"
          value={`${best.ticker} ${best.unrealized_pnl_pct != null ? `+${best.unrealized_pnl_pct.toFixed(1)}%` : ""}`}
          color="text-green-400"
        />
      )}
      {worst && worst.ticker !== best?.ticker && (
        <Stat
          label="Worst performer"
          value={`${worst.ticker} ${worst.unrealized_pnl_pct != null ? `${worst.unrealized_pnl_pct.toFixed(1)}%` : ""}`}
          color="text-red-400"
        />
      )}
      <Stat label="Buy signals" value={String(buyCount)} color="text-green-400" />
      <Stat label="Sell signals" value={String(sellCount)} color="text-red-400" />
      {undervaluedByPeg > 0 && (
        <Stat label="Undervalued (PEG < 1)" value={String(undervaluedByPeg)} color="text-green-400" />
      )}
      <div className="flex items-center gap-2 ml-auto">
        <Stat
          label="Stale / unanalyzed"
          value={`${staleCount} of ${holdings.length}`}
          color={staleCount > 0 ? "text-yellow-400" : "text-slate-400"}
        />
        {staleCount > 0 && onAnalyzeStale && (
          <button
            onClick={onAnalyzeStale}
            className="px-2.5 py-1 rounded bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30 transition-colors text-xs"
          >
            Analyze All Stale
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[80px]">
      <span className="text-slate-500 uppercase tracking-wide text-[10px]">{label}</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}
