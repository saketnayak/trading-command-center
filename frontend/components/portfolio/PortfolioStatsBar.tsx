"use client";
import type { PortfolioHolding, FundamentalsData, RegimeData, TrimSignalEntry } from "@/lib/types";

interface Props {
  holdings: PortfolioHolding[];
  onAnalyzeStale?: () => void;
  fundamentals?: Record<string, FundamentalsData>;
  regime?: Record<string, RegimeData>;
  trimSignals?: Record<string, TrimSignalEntry>;
}

const STALE_DAYS = 7;

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export function PortfolioStatsBar({ holdings, onAnalyzeStale, fundamentals, regime, trimSignals }: Props) {
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

  // Regime stats
  let bullCount = 0, sidewaysCount = 0, bearCount = 0;
  const regimeSignals: number[] = [];
  if (regime) {
    for (const h of holdings) {
      const r = regime[h.ticker];
      if (!r) continue;
      if (r.current_regime === "Bull") bullCount++;
      else if (r.current_regime === "Bear") bearCount++;
      else sidewaysCount++;
      regimeSignals.push(r.signal);
    }
  }
  const hasRegimeData = regimeSignals.length >= 2;
  const avgSignal = hasRegimeData ? regimeSignals.reduce((a, b) => a + b, 0) / regimeSignals.length : 0;
  const signalArrow = avgSignal > 0.1 ? "↑" : avgSignal < -0.1 ? "↓" : "→";
  const signalColor = avgSignal > 0.1 ? "text-green-400" : avgSignal < -0.1 ? "text-red-400" : "text-yellow-400";

  return (
    <div className="flex flex-wrap items-center gap-x-0 gap-y-2 bg-slate-800/40 border border-slate-700/60 rounded-lg text-xs overflow-hidden">
      {/* Performance group */}
      <div className="flex items-center gap-4 px-4 py-3">
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
      </div>

      <Divider />

      {/* Signals + PEG group */}
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex flex-col gap-0.5 min-w-[64px]">
          <span className="text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">AI Signals</span>
          <span className="font-semibold whitespace-nowrap">
            <span className="text-green-400">{buyCount} buy</span>
            <span className="text-slate-600"> · </span>
            <span className="text-red-400">{sellCount} sell</span>
          </span>
        </div>
        {undervaluedByPeg > 0 && (
          <Stat label="Undervalued (PEG &lt; 1)" value={String(undervaluedByPeg)} color="text-emerald-400" />
        )}
      </div>

      {/* Regime group */}
      {regimeSignals.length > 0 && (
        <>
          <Divider />
          <div className="flex items-center gap-4 px-4 py-3">
            <div
              className="flex flex-col gap-0.5"
              title="Markov regime distribution across holdings"
            >
              <span className="text-slate-500 uppercase tracking-wide text-[10px]">Regime</span>
              <span className="font-semibold whitespace-nowrap">
                <span className="text-green-400">{bullCount} Bull</span>
                <span className="text-slate-600"> · </span>
                <span className="text-yellow-400">{sidewaysCount} Sidew.</span>
                <span className="text-slate-600"> · </span>
                <span className="text-red-400">{bearCount} Bear</span>
              </span>
            </div>
            {hasRegimeData && (
              <div
                className="flex flex-col gap-0.5"
                title="Average Markov directional signal across holdings (bull_prob − bear_prob). Range: −1 to +1."
              >
                <span className="text-slate-500 uppercase tracking-wide text-[10px]">Avg signal</span>
                <span className={`font-semibold font-mono ${signalColor}`}>
                  {avgSignal >= 0 ? "+" : ""}{avgSignal.toFixed(2)} {signalArrow}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {trimSignals && (() => {
        const flagged = Object.values(trimSignals).filter((e) => e.level !== "none");
        if (flagged.length === 0) return null;
        const strong = flagged.filter((e) => e.level === "strong_trim").length;
        const consider = flagged.filter((e) => e.level === "consider_trim").length;
        const watch = flagged.filter((e) => e.level === "watch").length;
        return (
          <>
            <div className="self-stretch w-px bg-slate-700/60" />
            <div className="flex items-center gap-4 px-4 py-3">
              <div
                className="text-xs text-slate-400"
                title="Holdings flagged for review based on AI verdict, regime, valuation, and concentration."
              >
                Trim signals:{" "}
                {strong > 0 && <span className="text-red-400">{strong} strong</span>}
                {strong > 0 && (consider > 0 || watch > 0) && " · "}
                {consider > 0 && <span className="text-orange-400">{consider} consider</span>}
                {consider > 0 && watch > 0 && " · "}
                {watch > 0 && <span className="text-yellow-400">{watch} watch</span>}
              </div>
            </div>
          </>
        );
      })()}

      {/* Stale group — pushed right */}
      <div className="flex items-center gap-2 ml-auto px-4 py-3">
        <Stat
          label="Stale / unanalyzed"
          value={`${staleCount} of ${holdings.length}`}
          color={staleCount > 0 ? "text-amber-400" : "text-slate-500"}
        />
        {staleCount > 0 && onAnalyzeStale && (
          <button
            onClick={onAnalyzeStale}
            className="px-2.5 py-1 rounded-sm bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30 transition-colors text-xs"
          >
            Analyze All Stale
          </button>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="self-stretch w-px bg-slate-700/60" />;
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[64px]">
      <span className="text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">{label}</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}
