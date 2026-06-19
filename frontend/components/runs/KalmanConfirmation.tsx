"use client";
import { useQuery } from "@tanstack/react-query";
import { getTickerKalman } from "@/lib/api";
import type { KalmanData } from "@/lib/types";
import { fmtMoney, resolveQuoteCurrency } from "@/lib/currency";

interface Props {
  ticker: string;
  verdict: "buy" | "sell" | "hold" | null | undefined;
  priceCurrency?: string | null;
  metadataCurrency?: string | null;
}

function directionColor(direction: KalmanData["trend_direction"]): string {
  if (direction === "up") return "text-green-400";
  if (direction === "down") return "text-red-400";
  return "text-yellow-400";
}

function MiniKalmanChart({ chart, currency }: { chart: KalmanData["chart"]; currency: string }) {
  const width = 420;
  const height = 90;
  const values = [...chart.price, ...chart.kalman_price];
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;

  const scale = (series: number[]) =>
    series
      .map((value, idx) => {
        const xStep = series.length > 1 ? width / (series.length - 1) : width;
        const x = idx * xStep;
        const y = height - ((value - min) / span) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  if (chart.price.length < 2 || chart.kalman_price.length < 2) return null;

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Kalman smoothed price chart" className="w-full h-24">
        <polyline points={scale(chart.price)} fill="none" stroke="rgb(100 116 139)" strokeWidth="1.5" opacity="0.65" />
        <polyline points={scale(chart.kalman_price)} fill="none" stroke="rgb(59 130 246)" strokeWidth="2.5" />
      </svg>
      <div className="flex items-center justify-between text-[10px] text-muted font-mono">
        <span>{fmtMoney(min, currency)}</span>
        <span className="text-subtle">{currency}</span>
        <span>{fmtMoney(max, currency)}</span>
      </div>
    </div>
  );
}

export function KalmanConfirmation({ ticker, verdict, priceCurrency, metadataCurrency }: Props) {
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
          <MiniKalmanChart chart={kalman.chart} currency={currency} />
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>Price</span>
            <span className="text-blue-400">Kalman estimate</span>
          </div>
        </div>
      </div>
    </div>
  );
}
