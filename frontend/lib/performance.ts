/** Portfolio performance (GET /portfolio/{id}/performance): types and pure helpers. */

export type PerformanceMode = "auto" | "actual" | "current";
export type PerformanceRange = "1m" | "3m" | "6m" | "ytd" | "1y" | "3y" | "5y";

export const PERFORMANCE_RANGES: { id: PerformanceRange; label: string }[] = [
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1Y" },
  { id: "3y", label: "3Y" },
  { id: "5y", label: "5Y" },
];

export const BENCHMARK_PRESETS: { symbol: string; label: string }[] = [
  { symbol: "SPY", label: "S&P 500 (SPY)" },
  { symbol: "QQQ", label: "Nasdaq 100 (QQQ)" },
  { symbol: "VT", label: "Global stocks (VT)" },
  { symbol: "IWM", label: "Small caps (IWM)" },
  { symbol: "BTC-USD", label: "Bitcoin (BTC-USD)" },
];

export const PERIOD_KEYS = ["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface PerformancePoint {
  date: string;
  value: number;
  index: number;
  benchmark_index: number | null;
  drawdown: number;
}

export interface DayMove {
  date: string;
  return: number;
}

export interface PerformanceStats {
  total_return: number | null;
  annualised_return: number | null;
  volatility: number | null;
  sharpe: number | null;
  max_drawdown: number | null;
  max_drawdown_peak: string | null;
  max_drawdown_trough: string | null;
  best_day: DayMove | null;
  worst_day: DayMove | null;
  beta?: number | null;
  correlation?: number | null;
  excess_return?: number | null;
}

export interface PerformanceHolding {
  ticker: string;
  shares: number;
  value: number | null;
  weight: number | null;
  price_return: number | null;
  contribution: number | null;
}

export interface PortfolioPerformance {
  portfolio_id: string;
  mode: Exclude<PerformanceMode, "auto">;
  range: PerformanceRange;
  benchmark: string;
  display_currency: string;
  methodology: string;
  history_days: number;
  warnings: string[];
  start: string | null;
  end: string | null;
  series: PerformancePoint[];
  stats: PerformanceStats | null;
  benchmark_stats: PerformanceStats | null;
  period_returns: Partial<Record<PeriodKey, number | null>> | null;
  benchmark_period_returns: Partial<Record<PeriodKey, number | null>> | null;
  holdings: PerformanceHolding[];
  message: string | null;
}

/** 0.0523 → "+5.23%"; null → "—". */
export function fmtSignedPct(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const pct = x * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

/** 0.18 → "18.0%" (no sign; for volatility and weights). */
export function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtRatio(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

/** Tailwind text colour for a signed return. */
export function returnTone(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x) || x === 0) return "text-fg-secondary";
  return x > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

/** One-line plain-English verdict for the header. */
export function performanceHeadline(p: PortfolioPerformance): string | null {
  const total = p.stats?.total_return;
  const bench = p.benchmark_stats?.total_return;
  if (total == null) return null;
  if (bench == null) return `Your portfolio returned ${fmtSignedPct(total)} over this period.`;
  const excess = total - bench;
  if (Math.abs(excess) < 0.0005) {
    return `In line with ${p.benchmark}: both returned about ${fmtSignedPct(total)}.`;
  }
  const verb = excess > 0 ? "beat" : "trailed";
  return `You ${verb} ${p.benchmark} by ${fmtSignedPct(Math.abs(excess)).replace(/^[+−]/, "")} (${fmtSignedPct(total)} vs ${fmtSignedPct(bench)}).`;
}

export function performanceQueryParams(mode: PerformanceMode, range: PerformanceRange, benchmark: string): string {
  const params = new URLSearchParams({ mode, range, benchmark: benchmark.trim().toUpperCase() });
  return params.toString();
}

/** Mirrors the backend's benchmark validation so the input can refuse early. */
export function isValidBenchmark(symbol: string): boolean {
  return /^[A-Z0-9][A-Z0-9.\-^=]{0,15}$/.test(symbol.trim().toUpperCase());
}
