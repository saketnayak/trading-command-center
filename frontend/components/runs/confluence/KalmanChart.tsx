import { fmtMoney } from "@/lib/currency";
import type { KalmanData } from "@/lib/types";

type KalmanChartProps = {
  chart: KalmanData["chart"];
  currency: string;
  width?: number;
  height?: number;
  className?: string;
  showLegend?: boolean;
  expanded?: boolean;
};

export function KalmanChart({
  chart,
  currency,
  width = 420,
  height = 90,
  className = "",
  showLegend = true,
  expanded = false,
}: KalmanChartProps) {
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

  const priceStroke = expanded ? 2 : height <= 48 ? 1.25 : 1.5;
  const kalmanStroke = expanded ? 3 : height <= 48 ? 2 : 2.5;
  const legendClass = expanded ? "text-xs" : "text-[10px]";

  return (
    <div className={`space-y-2 ${className}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Kalman smoothed price chart"
        className="w-full"
        style={{ height: `${height}px` }}
      >
        <polyline
          points={scale(chart.price)}
          fill="none"
          stroke="rgb(100 116 139)"
          strokeWidth={priceStroke}
          opacity="0.65"
        />
        <polyline
          points={scale(chart.kalman_price)}
          fill="none"
          stroke="rgb(59 130 246)"
          strokeWidth={kalmanStroke}
        />
      </svg>
      {showLegend && (
        <>
          <div className={`flex items-center justify-between text-muted font-mono ${legendClass}`}>
            <span>{fmtMoney(min, currency)}</span>
            <span className="text-subtle">{currency}</span>
            <span>{fmtMoney(max, currency)}</span>
          </div>
          <div className={`flex items-center justify-between text-muted ${legendClass}`}>
            <span>Price</span>
            <span className="text-blue-400">Kalman estimate</span>
          </div>
        </>
      )}
    </div>
  );
}
