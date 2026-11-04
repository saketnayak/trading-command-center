/** Portfolio risk (GET /portfolio/{id}/risk): types and pure helpers. */

import { fmtMoney } from "./currency";
import { fmtPct } from "./performance";

export type RiskLookback = "3m" | "6m" | "1y" | "3y";

export const RISK_LOOKBACKS: { id: RiskLookback; label: string }[] = [
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "3y", label: "3Y" },
];

export interface RiskStats {
  volatility: number | null;
  beta: number | null;
  correlation: number | null;
  var_95: number | null;
  cvar_95: number | null;
  var_95_value: number | null;
  cvar_95_value: number | null;
  max_drawdown: number | null;
}

export interface RiskHolding {
  ticker: string;
  weight: number | null;
  risk_share: number | null;
  volatility: number | null;
  beta: number | null;
}

export interface RiskCluster {
  tickers: string[];
  combined_weight: number | null;
  average_correlation: number | null;
}

export interface FanPoint {
  day: number;
  p5: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
}

export interface MonteCarlo {
  horizon_days: number;
  paths: number;
  observations: number;
  fan: FanPoint[];
  terminal: Omit<FanPoint, "day">;
  prob_loss: number | null;
  prob_loss_10: number | null;
  prob_loss_20: number | null;
}

export interface StressLeg {
  ticker: string;
  return: number | null;
  method: "actual" | "beta" | "market";
}

export interface StressResult {
  id: string;
  name: string;
  start: string;
  end: string;
  note: string;
  market_return: number | null;
  market_source: "stored prices" | "S&P 500 index levels";
  portfolio_return: number | null;
  portfolio_impact: number | null;
  replayed_weight: number | null;
  worst: StressLeg[];
}

export interface RiskReport {
  observations: number;
  portfolio_value: number | null;
  stats: RiskStats;
  concentration: {
    hhi: number | null;
    effective_holdings: number | null;
    top1_weight: number | null;
    top5_weight: number | null;
    holdings: number;
  };
  holdings: RiskHolding[];
  correlation: { tickers: string[]; matrix: (number | null)[][]; truncated: boolean };
  top_pairs: { a: string; b: string; correlation: number | null }[];
  clusters: RiskCluster[];
  monte_carlo: MonteCarlo | null;
}

export interface PortfolioRisk {
  portfolio_id: string;
  lookback: RiskLookback;
  benchmark: string;
  display_currency: string;
  methodology: string;
  as_of?: string | null;
  warnings: string[];
  message: string | null;
  risk: RiskReport | null;
  stress: StressResult[];
}

/** "On a bad day…" sentence from the 1-day 95% VaR. */
export function varHeadline(r: PortfolioRisk): string | null {
  const s = r.risk?.stats;
  if (!s || s.var_95 == null) return null;
  const money = s.var_95_value != null ? `${fmtMoney(s.var_95_value, r.display_currency)} (${fmtPct(s.var_95)})` : fmtPct(s.var_95);
  return `On a bad day (1 in 20), this portfolio could lose about ${money} or more.`;
}

/** Plain-English line for a cluster of holdings that move together. */
export function clusterSentence(c: RiskCluster): string {
  const names = c.tickers.length > 3 ? `${c.tickers.slice(0, 3).join(", ")} and ${c.tickers.length - 3} more` : c.tickers.join(" + ");
  return `${names} move together (average correlation ${c.average_correlation?.toFixed(2) ?? "—"}): ${fmtPct(c.combined_weight, 0)} of your value behaves like one position.`;
}

/** How a stress row was built, for the method column. */
export function stressMethod(s: StressResult): string {
  const replayed = s.replayed_weight ?? 0;
  if (replayed >= 0.999) return "Replayed from real prices";
  if (replayed <= 0.001) return s.market_source === "stored prices" ? "Estimated: beta × S&P 500 move" : "Estimated: beta × S&P 500 index move";
  return `${fmtPct(replayed, 0)} replayed, rest estimated from beta`;
}

/** The biggest gap between value share and risk share (positive = carries more risk than value). */
export function riskOutlier(holdings: RiskHolding[]): RiskHolding | null {
  let best: RiskHolding | null = null;
  let gap = 0;
  for (const h of holdings) {
    if (h.weight == null || h.risk_share == null) continue;
    const g = h.risk_share - h.weight;
    if (g > gap + 1e-9) {
      gap = g;
      best = h;
    }
  }
  return best && gap >= 0.05 ? best : null;
}
