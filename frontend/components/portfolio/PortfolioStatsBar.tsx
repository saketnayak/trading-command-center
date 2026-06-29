"use client";
import { useState, type ReactNode } from "react";
import type { PortfolioHolding, FundamentalsData, RegimeData, TrimSignalEntry } from "@/lib/types";
import { BTN_AI_SM_CLASS } from "@/lib/uiClasses";

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
  const [expanded, setExpanded] = useState(false);

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

  let bullCount = 0;
  let sidewaysCount = 0;
  let bearCount = 0;
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

  const trimFlagged = trimSignals
    ? Object.values(trimSignals).filter((e) => e.level !== "none")
    : [];
  const hasExtraStats =
    (worst && worst.ticker !== best?.ticker) ||
    undervaluedByPeg > 0 ||
    regimeSignals.length > 0 ||
    trimFlagged.length > 0;

  return (
    <div className="rounded-lg border border-input-border/60 bg-input/40 text-xs overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        {best && (
          <Stat
            label="Top mover"
            value={`${best.ticker} ${best.unrealized_pnl_pct != null ? `+${best.unrealized_pnl_pct.toFixed(1)}%` : ""}`}
            color="text-green-400"
          />
        )}
        <Stat
          label="AI signals"
          value={
            <>
              <span className="text-green-400">{buyCount} buy</span>
              <span className="text-subtle"> · </span>
              <span className="text-red-400">{sellCount} sell</span>
            </>
          }
        />
        <div className="ml-auto flex items-center gap-2">
          <Stat
            label="Stale"
            value={`${staleCount} of ${holdings.length}`}
            color={staleCount > 0 ? "text-amber-400" : "text-muted"}
          />
          {staleCount > 0 && onAnalyzeStale && (
            <button type="button" onClick={onAnalyzeStale} className={BTN_AI_SM_CLASS}>
              Analyze stale
            </button>
          )}
        </div>
        {hasExtraStats && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            aria-expanded={expanded}
          >
            {expanded ? "Less stats" : "More stats"}
          </button>
        )}
      </div>

      {expanded && hasExtraStats && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-input-border/40 px-4 py-3">
          {worst && worst.ticker !== best?.ticker && (
            <Stat
              label="Laggard"
              value={`${worst.ticker} ${worst.unrealized_pnl_pct != null ? `${worst.unrealized_pnl_pct.toFixed(1)}%` : ""}`}
              color="text-red-400"
            />
          )}
          {undervaluedByPeg > 0 && (
            <Stat label="Undervalued (PEG &lt; 1)" value={String(undervaluedByPeg)} color="text-emerald-400" />
          )}
          {regimeSignals.length > 0 && (
            <Stat
              label="Regime"
              value={
                <>
                  <span className="text-green-400">{bullCount} bull</span>
                  <span className="text-subtle"> · </span>
                  <span className="text-yellow-400">{sidewaysCount} side</span>
                  <span className="text-subtle"> · </span>
                  <span className="text-red-400">{bearCount} bear</span>
                </>
              }
              title="Markov regime distribution across holdings"
            />
          )}
          {hasRegimeData && (
            <Stat
              label="Avg signal"
              value={`${avgSignal >= 0 ? "+" : ""}${avgSignal.toFixed(2)} ${signalArrow}`}
              color={signalColor}
              mono
              title="Average Markov directional signal (bull_prob − bear_prob)"
            />
          )}
          {trimFlagged.length > 0 && (
            <Stat
              label="Trim flags"
              value={String(trimFlagged.length)}
              color="text-orange-400"
              title="Holdings flagged for review"
            />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
  mono,
  title,
}: {
  label: string;
  value: React.ReactNode;
  color?: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[64px]" title={title}>
      <span className="text-muted text-xs whitespace-nowrap">{label}</span>
      <span className={`font-semibold whitespace-nowrap ${color ?? "text-fg"} ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}
