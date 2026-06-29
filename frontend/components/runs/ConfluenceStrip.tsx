"use client";

import { MarkovConfirmation } from "@/components/runs/MarkovConfirmation";
import { KalmanConfirmation } from "@/components/runs/KalmanConfirmation";
import { WaveConfirmation } from "@/components/wave/WaveConfirmation";
import type { Report, Run } from "@/lib/types";

type StrategyFlags = {
  markovEnabled: boolean;
  kalmanEnabled: boolean;
  waveEnabled: boolean;
};

type ConfluenceStripProps = {
  run: Run;
  report: Report | undefined;
  strategy: StrategyFlags;
  metadataCurrency?: string | null;
};

export function ConfluenceStrip({
  run,
  report,
  strategy,
  metadataCurrency,
}: ConfluenceStripProps) {
  const enabledCount = [
    strategy.markovEnabled,
    strategy.kalmanEnabled,
    strategy.waveEnabled,
  ].filter(Boolean).length;

  if (enabledCount === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted">
        <span>Signal confluence</span>
        <span className="normal-case tracking-normal text-[10px] text-subtle">
          {enabledCount} signal{enabledCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-2 border-t border-input-border px-3 pb-3 pt-2">
        {strategy.markovEnabled && (
          <MarkovConfirmation
            ticker={run.ticker}
            verdict={run.verdict}
            variant="compact"
          />
        )}
        {strategy.kalmanEnabled && (
          <KalmanConfirmation
            ticker={run.ticker}
            verdict={run.verdict}
            priceCurrency={report?.price_currency ?? run.price_currency}
            metadataCurrency={metadataCurrency}
            variant="compact"
          />
        )}
        {strategy.waveEnabled && (
          <WaveConfirmation
            ticker={run.ticker}
            verdict={run.verdict}
            suggestedEntry={report?.suggested_entry}
            suggestedStop={report?.suggested_stop}
            suggestedTarget={report?.suggested_target}
            priceCurrency={report?.price_currency ?? run.price_currency}
            variant="compact"
          />
        )}
      </div>
    </div>
  );
}
