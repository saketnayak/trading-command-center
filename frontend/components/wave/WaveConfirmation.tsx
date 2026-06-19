"use client";

import { useQuery } from "@tanstack/react-query";
import { getTickerWaveSummary } from "@/lib/api";
import type { WaveSummary } from "@/lib/types";
import { fmtMoney, fmtPriceString, resolveQuoteCurrency } from "@/lib/currency";

interface Props {
  ticker: string;
  verdict: "buy" | "sell" | "hold" | null | undefined;
  suggestedEntry?: string | null;
  suggestedStop?: string | null;
  suggestedTarget?: string | null;
  priceCurrency?: string | null;
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

export function WaveConfirmation({
  ticker,
  verdict,
  suggestedEntry,
  suggestedStop,
  suggestedTarget,
  priceCurrency,
}: Props) {
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

      <div className="border-t border-input-border/50 pt-3 space-y-2 text-xs">
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
      </div>
    </div>
  );
}
