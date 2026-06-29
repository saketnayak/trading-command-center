"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyzeWave, getTickerWaveSummary } from "@/lib/api";
import type { WaveSummary } from "@/lib/types";
import { fmtMoney, fmtPriceString, resolveQuoteCurrency } from "@/lib/currency";
import { ChartQuickLook } from "@/components/ui/ChartQuickLook";
import { AnalysisChart } from "@/components/wave/AnalysisChart";
import { WaveSparkline } from "@/components/wave/WaveSparkline";

interface Props {
  ticker: string;
  verdict: "buy" | "sell" | "hold" | null | undefined;
  suggestedEntry?: string | null;
  suggestedStop?: string | null;
  suggestedTarget?: string | null;
  priceCurrency?: string | null;
  variant?: "default" | "compact";
}

function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function directionAligns(verdict: string, direction: string | null | undefined): boolean | null {
  if (!direction || verdict === "hold") return null;
  if (verdict === "buy" && direction === "long") return true;
  if (verdict === "sell" && direction === "short") return true;
  if (verdict === "buy" && direction === "short") return false;
  if (verdict === "sell" && direction === "long") return false;
  return null;
}

function WaveFullChartPanel({ ticker, fill = false }: { ticker: string; fill?: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["wave-analyze", ticker, "confluence-preview"],
    queryFn: () => analyzeWave(ticker),
    staleTime: 1000 * 60 * 60 * 4,
    retry: false,
  });

  if (isLoading) {
    return <p className="text-[10px] text-muted p-4">Loading chart…</p>;
  }

  if (isError || !data?.chart) {
    return <p className="text-[10px] text-muted p-4">Chart unavailable.</p>;
  }

  return (
    <AnalysisChart
      chart={data.chart}
      title={`${ticker} Elliott / Fib`}
      fill={fill}
      className={fill ? "h-full min-h-0 flex-1 border-0 bg-page rounded-none" : ""}
    />
  );
}

export function WaveConfirmation({
  ticker,
  verdict,
  suggestedEntry,
  suggestedStop,
  suggestedTarget,
  priceCurrency,
  variant = "default",
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data: wave, isLoading } = useQuery<WaveSummary | null>({
    queryKey: ["ticker-wave", ticker],
    queryFn: () => getTickerWaveSummary(ticker),
    staleTime: 1000 * 60 * 60 * 4,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="bg-elevated border border-input-border rounded-lg p-4 text-xs text-muted">
        Loading wave analysis…
      </div>
    );
  }

  if (!wave) return null;

  const waveCurrency = wave.currency ?? "USD";
  const aiCurrency = resolveQuoteCurrency(priceCurrency, waveCurrency);
  const aligns = verdict ? directionAligns(verdict, wave.top_direction) : null;
  const borderColor =
    aligns === false
      ? "border-amber-500/40"
      : aligns === true
        ? "border-green-500/40"
        : "border-input-border";

  const entry = parsePrice(suggestedEntry);
  const inZone =
    entry != null &&
    wave.zone_low != null &&
    wave.zone_high != null &&
    entry >= wave.zone_low &&
    entry <= wave.zone_high;

  const agreementLabel =
    aligns === false ? "Conflicts" : aligns === true ? "Confirms" : "Neutral";
  const agreementClass =
    aligns === false ? "text-amber-400" : aligns === true ? "text-green-400" : "text-muted";

  const waveChartThumbnail = (
    <div className="rounded-md border border-input-border/60 bg-page px-2 py-1.5">
      <WaveSparkline
        closes={wave.sparkline ?? []}
        zoneLow={wave.zone_low}
        zoneHigh={wave.zone_high}
        invalidationLevel={wave.invalidation_level}
        entry={entry}
      />
    </div>
  );

  if (variant === "compact") {
    const chevron = (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted-surface text-base leading-none text-fg-secondary group-open:rotate-180 transition-transform duration-200">
        ▾
      </span>
    );

    const compactBody = (
      <div className="px-3 pb-3 pt-2 border-t border-input-border/50 space-y-2">
        <p className="font-semibold text-fg">
          {wave.top_direction ?? "—"}
          {wave.top_scenario ? ` · ${wave.top_scenario}` : ""}
        </p>
        {wave.zone_low != null && wave.zone_high != null && (
          <p className="font-mono text-[10px] text-muted">
            Zone {fmtMoney(wave.zone_low, waveCurrency)} – {fmtMoney(wave.zone_high, waveCurrency)}
            {entry != null && (
              <span className={inZone ? " text-green-400" : ""}>
                {inZone ? " · entry in zone" : " · entry outside"}
              </span>
            )}
          </p>
        )}
        <ChartQuickLook
          label="Elliott / Fibonacci chart"
          maxWidth={960}
          fillContent
          thumbnail={waveChartThumbnail}
          preview={() => <WaveFullChartPanel ticker={ticker} fill />}
        />
      </div>
    );

    return (
      <details
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        className={`bg-elevated border ${borderColor} rounded-lg text-xs group`}
      >
        <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between gap-2">
          <span className="font-medium text-fg">Elliott / Fib</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`font-semibold ${agreementClass}`}>{agreementLabel}</span>
            {chevron}
          </div>
        </summary>
        {compactBody}
      </details>
    );
  }

  return (
    <div className={`bg-elevated border ${borderColor} rounded-lg p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Elliott / Fib Check</h3>
        <span className="text-[10px] text-muted uppercase tracking-wide">yfinance · 2y daily · {waveCurrency}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted uppercase text-[10px] tracking-wide block">AI Verdict</span>
          <span className="text-fg font-semibold uppercase">{verdict ?? "—"}</span>
        </div>
        <div>
          <span className="text-muted uppercase text-[10px] tracking-wide block">Wave bias</span>
          <span className="text-fg font-semibold">
            {wave.top_direction ?? "—"}
            {wave.top_scenario ? ` · ${wave.top_scenario}` : ""}
          </span>
        </div>
        <div className="col-span-2">
          <span className="text-muted uppercase text-[10px] tracking-wide block">Agreement</span>
          {aligns === false ? (
            <span className="text-amber-400 font-semibold">
              ⚠ Conflicts — wave bias is {wave.top_direction}
            </span>
          ) : aligns === true ? (
            <span className="text-green-400 font-semibold">✓ Direction aligns</span>
          ) : (
            <span className="text-muted">— Neutral or no verdict</span>
          )}
        </div>
      </div>

      <div className="border-t border-input-border/50 pt-3 space-y-3 text-xs">
        {wave.zone_low != null && wave.zone_high != null && (
          <div>
            <span className="text-muted text-[10px] uppercase tracking-wide block">Trade zone</span>
            <span className="font-mono text-fg-secondary">
              {fmtMoney(wave.zone_low, waveCurrency)} – {fmtMoney(wave.zone_high, waveCurrency)}
              {entry != null && (
                <span className={inZone ? " text-green-400 ml-2" : " text-muted ml-2"}>
                  {inZone ? "· entry in zone" : "· entry outside zone"}
                </span>
              )}
            </span>
          </div>
        )}
        {wave.invalidation_level != null && (
          <div>
            <span className="text-muted text-[10px] uppercase tracking-wide block">Invalidation</span>
            <span className="font-mono text-fg-secondary">{fmtMoney(wave.invalidation_level, waveCurrency)}</span>
          </div>
        )}
        {(suggestedStop || suggestedTarget) && (
          <div className="flex flex-wrap gap-4">
            {suggestedStop && (
              <div>
                <span className="text-muted text-[10px] uppercase tracking-wide block">AI stop</span>
                <span className="font-mono text-fg-secondary">{fmtPriceString(suggestedStop, aiCurrency)}</span>
              </div>
            )}
            {suggestedTarget && (
              <div>
                <span className="text-muted text-[10px] uppercase tracking-wide block">AI target</span>
                <span className="font-mono text-fg-secondary">{fmtPriceString(suggestedTarget, aiCurrency)}</span>
              </div>
            )}
          </div>
        )}
        {wave.warnings.length > 0 && (
          <ul className="text-amber-300/90 space-y-1">
            {wave.warnings.slice(0, 3).map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        )}

        <ChartQuickLook
          label="Elliott / Fibonacci chart"
          maxWidth={960}
          fillContent
          thumbnail={waveChartThumbnail}
          preview={() => <WaveFullChartPanel ticker={ticker} fill />}
        />
      </div>
    </div>
  );
}
