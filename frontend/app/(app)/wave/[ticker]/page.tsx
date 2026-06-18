"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { analyzeWave, getAppSettings } from "@/lib/api";
import { AnalysisChart } from "@/components/wave/AnalysisChart";
import { useTickerMetadata } from "@/lib/useTickerMetadata";
import { TOP_NAV_HEIGHT_REM } from "@/components/layout/constants";
import type {
  AnalyzeResponse,
  ChartVisibilityOptions,
  ElliottScenario,
  TradeRegion,
} from "@/lib/wave/types";

const DEFAULT_VISIBILITY: ChartVisibilityOptions = {
  waves: true,
  fibonacci: true,
  projection: true,
  pivots: true,
  showAllHistory: true,
};

export default function WaveChartPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const symbol = decodeURIComponent(ticker).toUpperCase();
  const [visibility, setVisibility] = useState<ChartVisibilityOptions>(DEFAULT_VISIBILITY);

  const { data: strategySettings, isLoading: settingsLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: getAppSettings,
    retry: false,
  });
  const waveEnabled = strategySettings?.enableElliottWave !== false;

  const { data, isLoading, isError, error } = useQuery<AnalyzeResponse>({
    queryKey: ["wave-analyze", symbol],
    queryFn: () => analyzeWave(symbol),
    staleTime: 1000 * 60 * 60 * 4,
    retry: false,
    enabled: !settingsLoading && waveEnabled,
  });

  const { data: metadataByTicker = {} } = useTickerMetadata([symbol]);
  const metadata = metadataByTicker[symbol];
  const companyName = metadata?.company_name ?? metadata?.display_name ?? data?.instrument.symbol ?? symbol;
  const scenario = data?.top_scenarios[0] ?? null;
  const tradeRegion = data?.trade_regions[0] ?? data?.overview?.trade_region ?? null;
  const title = `${symbol} Elliott / Fibonacci`;

  return (
    <main
      className="flex min-h-[620px] flex-col overflow-hidden bg-page"
      style={{ height: `calc(100vh - ${TOP_NAV_HEIGHT_REM})` }}
    >
      <header className="shrink-0 border-b border-border bg-elevated px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href="/portfolio" className="text-xs text-link hover:text-link-hover">
              ← Portfolio
            </Link>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="font-mono text-2xl font-semibold text-fg">{symbol}</h1>
              <p className="truncate text-sm text-muted">{companyName}</p>
            </div>
          </div>
          <VisibilityControls value={visibility} onChange={setVisibility} />
        </div>
      </header>

      {settingsLoading && (
        <div className="m-4 flex-1 rounded-lg border border-border bg-input/50 animate-pulse" />
      )}

      {!settingsLoading && !waveEnabled && (
        <div className="m-4 rounded-lg border border-border bg-elevated p-6 text-sm text-muted">
          <h2 className="mb-2 text-base font-semibold text-fg">Module Unavailable</h2>
          <p>The Elliott Wave module is currently disabled by an administrator.</p>
        </div>
      )}

      {!settingsLoading && waveEnabled && isLoading && (
        <div className="m-4 flex-1 rounded-lg border border-border bg-input/50 animate-pulse" />
      )}

      {!settingsLoading && waveEnabled && (isError || !data) && !isLoading && (
        <div className="m-4 rounded-lg border border-border bg-elevated p-4 text-sm text-muted">
          {error instanceof Error ? error.message : "Analysis unavailable for this ticker."}
        </div>
      )}

      {!settingsLoading && waveEnabled && data && (
        <section className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <SummaryStrip
            scenario={scenario}
            tradeRegion={tradeRegion}
            projectionTarget={data.projection?.primary_target ?? null}
            projectionConfidence={data.projection?.confidence ?? null}
          />
          <div className="min-h-0 flex-1">
            <AnalysisChart
              chart={data.chart}
              title={title}
              height="100%"
              showModeBar
              visibility={visibility}
              className="h-full rounded-none"
            />
          </div>
        </section>
      )}
    </main>
  );
}

function VisibilityControls({
  value,
  onChange,
}: {
  value: ChartVisibilityOptions;
  onChange: (value: ChartVisibilityOptions) => void;
}) {
  const options: Array<{ key: keyof ChartVisibilityOptions; label: string }> = [
    { key: "waves", label: "Waves" },
    { key: "fibonacci", label: "Fib" },
    { key: "projection", label: "Projection" },
    { key: "pivots", label: "Pivots" },
    { key: "showAllHistory", label: "Full history" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => {
        const active = value[option.key];
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange({ ...value, [option.key]: !active })}
            className={`rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors ${
              active
                ? "border-info/40 bg-info-soft text-info"
                : "border-border bg-surface text-muted hover:text-fg"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryStrip({
  scenario,
  tradeRegion,
  projectionTarget,
  projectionConfidence,
}: {
  scenario: ElliottScenario | null;
  tradeRegion: TradeRegion | null;
  projectionTarget: number | null;
  projectionConfidence: number | null;
}) {
  return (
    <div className="grid shrink-0 gap-2 sm:grid-cols-5">
      <Metric label="Pattern" value={scenario ? `${scenario.pattern} / ${scenario.trend}` : "-"} />
      <Metric label="Confidence" value={formatConfidence(tradeRegion, scenario)} />
      <Metric label="Projected target" value={projectionTarget == null ? "-" : fmtPrice(projectionTarget)} />
      <Metric label="Projection conf." value={projectionConfidence == null ? "-" : `${projectionConfidence.toFixed(0)} / 100`} />
      <Metric label="Entry zone" value={formatZone(tradeRegion)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-elevated px-3 py-2">
      <span className="block text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className="font-mono text-sm font-semibold text-fg">{value}</span>
    </div>
  );
}

function formatConfidence(region: TradeRegion | null, scenario: ElliottScenario | null): string {
  const value = region?.confidence ?? scenario?.score;
  return value == null ? "-" : `${value.toFixed(0)} / 100`;
}

function formatZone(region: TradeRegion | null): string {
  if (!region) return "-";
  return `${fmtPrice(region.zone_low)} - ${fmtPrice(region.zone_high)}`;
}

function fmtPrice(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `$${value.toFixed(2)}`;
}
