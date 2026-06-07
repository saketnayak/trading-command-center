"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { analyzeWave } from "@/lib/api";
import type { AnalyzeResponse, ElliottScenario, TradeRegion } from "@/lib/wave/types";

interface WavePanelProps {
  ticker: string;
}

export function WavePanel({ ticker }: WavePanelProps) {
  const { data, isLoading, isError, error } = useQuery<AnalyzeResponse>({
    queryKey: ["wave-analyze", ticker],
    queryFn: () => analyzeWave(ticker),
    staleTime: 1000 * 60 * 60 * 4,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-muted uppercase tracking-widest font-medium">
          Elliott Wave &amp; Fibonacci
        </p>
        <p className="text-xs text-muted">Loading wave setup…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-muted uppercase tracking-widest font-medium">
          Elliott Wave &amp; Fibonacci
        </p>
        <p className="text-xs text-muted">
          {error instanceof Error ? error.message : "Analysis unavailable for this ticker."}
        </p>
      </div>
    );
  }

  const scenario = data.top_scenarios[0] ?? null;
  const tradeRegion = data.trade_regions[0] ?? data.overview?.trade_region ?? null;
  const direction = tradeRegion?.direction ?? data.overview?.top_direction ?? scenario?.trend ?? null;
  const directionTone =
    direction === "long" || direction === "bullish"
      ? "text-success bg-success-soft/60 border-success/30"
      : direction === "short" || direction === "bearish"
        ? "text-danger bg-danger-soft/60 border-danger/30"
        : "text-muted bg-muted-surface border-border";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-muted uppercase tracking-widest font-medium">
          Elliott Wave &amp; Fibonacci
        </p>
        <span className={`rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase ${directionTone}`}>
          {direction ?? "neutral"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Pattern" value={formatScenario(scenario)} />
        <Metric label="Confidence" value={formatConfidence(tradeRegion, scenario)} />
        <Metric label="Entry zone" value={formatZone(tradeRegion)} />
        <Metric label="Risk level" value={formatRiskLevel(tradeRegion, scenario)} />
      </div>

      {tradeRegion && (
        <div className="rounded-md border border-border bg-surface px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] uppercase tracking-wide text-muted">
              Targets
            </span>
            <span className="font-mono text-xs text-fg-secondary">
              {formatTargets(tradeRegion)}
            </span>
          </div>
        </div>
      )}

      <DecisionNote scenario={scenario} tradeRegion={tradeRegion} warning={data.overview?.warnings[0]} />

      <Link
        href={`/wave/${encodeURIComponent(ticker.toUpperCase())}`}
        className="inline-flex text-xs font-medium text-link hover:text-link-hover"
      >
        Open full Elliott/Fib chart →
      </Link>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <span className="block text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className="mt-0.5 block truncate font-mono text-xs font-semibold text-fg" title={value}>
        {value}
      </span>
    </div>
  );
}

function DecisionNote({
  scenario,
  tradeRegion,
  warning,
}: {
  scenario: ElliottScenario | null;
  tradeRegion: TradeRegion | null;
  warning?: string;
}) {
  const note = tradeRegion?.rationale[0] ?? scenario?.notes[0] ?? warning;
  if (!note) return null;

  return (
    <p className="rounded-md border border-border bg-elevated px-3 py-2 text-xs leading-relaxed text-fg-secondary">
      {note}
    </p>
  );
}

function formatScenario(scenario: ElliottScenario | null): string {
  if (!scenario) return "No setup";
  return `${scenario.pattern} / ${scenario.trend}`;
}

function formatConfidence(region: TradeRegion | null, scenario: ElliottScenario | null): string {
  const value = region?.confidence ?? scenario?.score;
  return value == null ? "-" : `${value.toFixed(0)} / 100`;
}

function formatZone(region: TradeRegion | null): string {
  if (!region) return "-";
  return `${fmtPrice(region.zone_low)} - ${fmtPrice(region.zone_high)}`;
}

function formatRiskLevel(region: TradeRegion | null, scenario: ElliottScenario | null): string {
  const level = region?.stop_level ?? scenario?.invalidation_level;
  return level == null ? "-" : fmtPrice(level);
}

function formatTargets(region: TradeRegion): string {
  if (region.target_levels.length === 0) return "-";
  return region.target_levels.slice(0, 3).map(fmtPrice).join(" / ");
}

function fmtPrice(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `$${value.toFixed(2)}`;
}
