/** Agent Backtest Lab (/backtests) and the model leaderboard (/runs/leaderboard): types and helpers. */

export type BacktestStatus = "pending" | "running" | "completed" | "stopped" | "failed" | "aborted" | "interrupted";

export interface BacktestConfig {
  tickers: string[];
  start_date: string;
  end_date: string;
  frequency: "weekly" | "daily";
  horizon_days: number;
  llm_provider: string;
  llm_model: string;
  depth: string;
  analysts: string[];
  budget_usd: number | null;
  dry_run: boolean;
  reflect: boolean;
  training_cutoff: string | null;
  cutoff_source: "you" | "table" | null;
  total_decisions: number;
}

export interface CurveStats {
  total_return: number;
  max_drawdown: number;
  sharpe: number | null;
}

export interface BacktestSummaryStats extends CurveStats {
  decisions: number;
  periods: number;
  signals: { BUY: number; SELL: number; HOLD: number };
  hit_rate: number | null;
  expectancy: number | null;
  avg_return: number;
  benchmarks: Record<string, CurveStats>;
  excess_vs_buy_and_hold: number | null;
}

export interface BacktestTrade {
  ticker: string;
  decision_date: string;
  signal: "BUY" | "SELL" | "HOLD";
  size_fraction: number | null;
  confidence: number | null;
  rationale: string;
  entry_price: number | null;
  exit_date: string | null;
  exit_price: number | null;
  realised_return: number;
  benchmark_returns: Record<string, number>;
  notes: string;
}

export interface BacktestReport {
  cutoff: string | null;
  headline_basis: "out_of_sample" | "all" | "none";
  headline: BacktestSummaryStats | null;
  out_of_sample: BacktestSummaryStats | null;
  in_sample: BacktestSummaryStats | null;
  counts: { out_of_sample: number; in_sample: number; errors: number; total: number };
  note: string;
}

export interface BacktestSummary {
  id: string;
  name: string;
  status: BacktestStatus;
  config: BacktestConfig;
  total_decisions: number;
  done: number;
  cost_usd: number;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  headline_basis: BacktestReport["headline_basis"] | null;
  headline: Pick<BacktestSummaryStats, "total_return" | "hit_rate" | "sharpe" | "excess_vs_buy_and_hold"> | null;
}

export interface BacktestDetail extends BacktestSummary {
  trades: BacktestTrade[];
  report: BacktestReport | null;
}

export interface BacktestMeta {
  limits: { tickers: number; decisions: number; decisions_dry_run: number; budget_usd: number; horizon_days: [number, number] };
  analysts: string[];
  model_cutoffs: Record<string, string>;
}

export interface BacktestInput {
  name?: string;
  tickers: string[];
  start_date: string;
  end_date: string;
  frequency: "weekly" | "daily";
  horizon_days: number;
  llm_provider: string;
  llm_model: string;
  depth: string;
  analysts: string[];
  budget_usd?: number;
  dry_run: boolean;
  reflect: boolean;
  training_cutoff?: string;
}

export interface LeaderboardGroup {
  group: string;
  runs: number;
  "7d": { scored: number; accuracy: number | null; avg_return: number | null; avg_excess: number | null };
  "30d": { scored: number; accuracy: number | null; avg_return: number | null; avg_excess: number | null };
}

export interface Leaderboard {
  group_by: "model" | "depth" | "analysts";
  groups: LeaderboardGroup[];
  benchmark_available: boolean;
  note: string;
}

export const BENCHMARK_LABELS: Record<string, string> = {
  buy_and_hold: "Buy and hold",
  always_hold: "Always hold (cash)",
  sma_crossover: "SMA crossover",
  random_baseline: "Random",
};

export const STATUS_LABELS: Record<BacktestStatus, string> = {
  pending: "Queued",
  running: "Running",
  completed: "Completed",
  stopped: "Stopped at budget",
  failed: "Failed",
  aborted: "Stopped",
  interrupted: "Interrupted",
};

export const ACTIVE_STATUSES: BacktestStatus[] = ["pending", "running"];

/** Known training cutoff for a model, longest name prefix first (mirrors the server). */
export function cutoffFor(model: string, cutoffs: Record<string, string>): string | null {
  const name = model.toLowerCase().split("/").pop() ?? "";
  // Never borrow a cutoff across versions: "gpt-5.5" is not "gpt-5" (mirrors the server).
  const suffix = /^($|:|[-_@](\d{4}|[a-z]))/;
  const prefix = Object.keys(cutoffs).sort((a, b) => b.length - a.length)
    .find((p) => name.startsWith(p) && suffix.test(name.slice(p.length)));
  return prefix ? cutoffs[prefix] : null;
}

/** Decision dates in a range, as the harness builds them: business days, or the Fridays (all business days without one). */
export function decisionDates(start: string, end: string, frequency: "weekly" | "daily"): string[] {
  if (!start || !end || start > end) return [];
  const days: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  while (d <= stop && days.length < 5000) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  if (frequency === "weekly") {
    const fridays = days.filter((x) => new Date(`${x}T00:00:00Z`).getUTCDay() === 5);
    return fridays.length ? fridays : days;
  }
  return days;
}

/** How the backtest's dates sit against the model's cutoff, in a sentence. */
export function cutoffAdvice(start: string, end: string, cutoff: string | null): { tone: "ok" | "warn"; text: string } {
  if (!cutoff) return { tone: "warn", text: "No known training cutoff for this model: every result could include hindsight. Enter one if you know it." };
  if (start > cutoff) return { tone: "ok", text: `All dates are after the model's training cutoff (${cutoff}): an honest out-of-sample test.` };
  if (end <= cutoff) return { tone: "warn", text: `All dates are on or before the model's training cutoff (${cutoff}): it may already know what happened, so there will be no headline score.` };
  return { tone: "warn", text: `Dates before ${cutoff} are in-sample and reported separately; the headline uses only later dates.` };
}

export function parseTickers(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
}

/** Growth of 1 per decision date: each date's return is the average across that date's scored decisions. */
export function equityCurve(trades: BacktestTrade[], pick: (t: BacktestTrade) => number | undefined): { dates: string[]; values: number[] } {
  const byDate = new Map<string, number[]>();
  for (const t of trades) {
    if (t.entry_price == null || t.exit_price == null || t.notes.includes("error")) continue;
    const v = pick(t);
    if (v == null) continue;
    byDate.set(t.decision_date, [...(byDate.get(t.decision_date) ?? []), v]);
  }
  const dates = [...byDate.keys()].sort();
  let equity = 1;
  const values = dates.map((d) => {
    const rs = byDate.get(d)!;
    equity *= 1 + rs.reduce((a, b) => a + b, 0) / rs.length;
    return equity;
  });
  return { dates, values };
}
