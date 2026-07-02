"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTickerKalman } from "@/lib/api";
import type { KalmanData } from "@/lib/types";
import { fmtMoney, resolveQuoteCurrency } from "@/lib/currency";
import { ChartQuickLook } from "@/components/ui/ChartQuickLook";
import { KalmanChart } from "@/components/runs/confluence/KalmanChart";

interface Props {
  ticker: string;
  verdict: "buy" | "sell" | "hold" | null | undefined;
  priceCurrency?: string | null;
  metadataCurrency?: string | null;
  variant?: "default" | "compact";
}

function directionColor(direction: KalmanData["trend_direction"]): string {
  if (direction === "up") return "text-green-400";
  if (direction === "down") return "text-red-400";
  return "text-yellow-400";
}

export function KalmanConfirmation({
  ticker,
  verdict,
  priceCurrency,
  metadataCurrency,
  variant = "default",
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data: kalman, isLoading } = useQuery<KalmanData | null>({
    queryKey: ["ticker-kalman", ticker],
    queryFn: () => getTickerKalman(ticker),
    staleTime: 1000 * 60 * 60 * 4,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="bg-elevated border border-input-border rounded-lg p-4 text-xs text-muted">
        Loading Kalman analysis...
      </div>
    );
  }

  if (!kalman) return null;

  const currency = resolveQuoteCurrency(kalman.currency, priceCurrency ?? metadataCurrency);
  const isConflict =
    verdict != null &&
    verdict !== "hold" &&
    ((verdict === "buy" && kalman.signal < -0.05) || (verdict === "sell" && kalman.signal > 0.05));
  const isNeutral = !verdict || verdict === "hold" || kalman.trend_direction === "flat";
  const signalStr = kalman.signal >= 0 ? `+${kalman.signal.toFixed(2)}` : kalman.signal.toFixed(2);
  const borderColor = isConflict ? "border-amber-500/40" : !isNeutral ? "border-green-500/40" : "border-input-border";
  const agreementLabel = isConflict ? "Conflicts" : isNeutral ? "Neutral" : "Confirms";
  const agreementClass = isConflict ? "text-amber-400" : isNeutral ? "text-muted" : "text-green-400";

  const chartThumbnail = (
    <div className="rounded-md border border-input-border/60 bg-page px-2 py-1.5">
      <KalmanChart chart={kalman.chart} currency={currency} height={48} showLegend={false} />
    </div>
  );

  const chartPreviewExpanded = (
    <KalmanChart
      chart={kalman.chart}
      currency={currency}
      width={720}
      height={180}
      expanded
    />
  );

  const chartPreviewInline = (
    <KalmanChart chart={kalman.chart} currency={currency} width={420} height={90} />
  );

  if (variant === "compact") {
    const chevron = (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted-surface text-base leading-none text-fg-secondary group-open:rotate-180 transition-transform duration-200">
        ▾
      </span>
    );

    const compactBody = (
      <div className="px-3 pb-3 pt-2 border-t border-input-border/50 space-y-2">
        <p className={`font-semibold capitalize ${directionColor(kalman.trend_direction)}`}>
          {kalman.trend_direction} · <span className="font-mono">{signalStr}</span>
        </p>
        <div className="flex flex-wrap gap-3 text-[10px] text-muted font-mono">
          <span>{fmtMoney(kalman.latest_price, currency)}</span>
          <span>Kalman {fmtMoney(kalman.kalman_price, currency)}</span>
        </div>
        <ChartQuickLook
          label="Kalman price chart"
          maxWidth={760}
          thumbnail={chartThumbnail}
          preview={chartPreviewExpanded}
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
          <span className="font-medium text-fg">Kalman trend</span>
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
        <h3 className="text-sm font-semibold text-fg">Kalman Trend Check</h3>
        <span className="text-[10px] text-muted uppercase tracking-wide">
          yfinance · {kalman.interval} · {kalman.mode} · {currency}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted uppercase text-[10px] tracking-wide block">AI Verdict</span>
          <span className="text-fg font-semibold uppercase">{verdict ?? "-"}</span>
        </div>
        <div>
          <span className="text-muted uppercase text-[10px] tracking-wide block">Kalman Trend</span>
          <span className={`font-semibold capitalize ${directionColor(kalman.trend_direction)}`}>
            {kalman.trend_direction} <span className="font-mono">{signalStr}</span>
          </span>
        </div>
        <div className="col-span-2">
          <span className="text-muted uppercase text-[10px] tracking-wide block">Agreement</span>
          {isConflict ? (
            <span className="text-amber-400 font-semibold">
              Conflicts: causal trend is {kalman.trend_direction} (signal {signalStr})
            </span>
          ) : isNeutral ? (
            <span className="text-muted">Neutral</span>
          ) : (
            <span className="text-green-400 font-semibold">Confirms</span>
          )}
        </div>
      </div>

      <div className="border-t border-input-border/50 pt-3 space-y-3">
        <div className="flex flex-wrap gap-4 text-xs">
          <div>
            <span className="text-muted text-[10px] uppercase tracking-wide block">Latest Price ({currency})</span>
            <span className="font-mono text-fg-secondary">{fmtMoney(kalman.latest_price, currency)}</span>
          </div>
          <div>
            <span className="text-muted text-[10px] uppercase tracking-wide block">Kalman Price ({currency})</span>
            <span className="font-mono text-fg-secondary">{fmtMoney(kalman.kalman_price, currency)}</span>
          </div>
          <div>
            <span className="text-muted text-[10px] uppercase tracking-wide block">Latent Slope</span>
            <span className={`font-mono ${directionColor(kalman.trend_direction)}`}>
              {kalman.kalman_trend.toFixed(4)}
            </span>
          </div>
          <div>
            <span className="text-muted text-[10px] uppercase tracking-wide block">Observations</span>
            <span className="font-mono text-fg-secondary">{kalman.observations}</span>
          </div>
        </div>

        <div className="bg-page border border-input-border/60 rounded-md p-2">
          {chartPreviewInline}
        </div>
      </div>
    </div>
  );
}
