/** Learning loop (GET/PUT /learning): types and helpers. */

export interface LearningReflection {
  run_id: string;
  ticker: string;
  analysis_date: string;
  verdict: string | null;
  model: string;
  status: "done" | "failed" | "skipped";
  horizon_days: number;
  realised_return: number | null;
  stock_return: number | null;
  error: string | null;
  attempts: number;
  created_at: string | null;
}

export interface LearningStatus {
  enabled: boolean;
  horizon_days: number;
  horizons: number[];
  memories: Record<string, number>;
  reflections: { done: number; failed: number; skipped: number };
  due: number | null;
  running: boolean;
  recent: LearningReflection[];
  per_pass: number;
}

export const MEMORY_LABELS: Record<string, string> = {
  bull_memory: "Bull researcher",
  bear_memory: "Bear researcher",
  trader_memory: "Trader",
  invest_judge_memory: "Research manager",
  risk_manager_memory: "Risk judge",
};

/** "12 lessons across 5 agents", or a hint when there are none yet. */
export function memorySummary(s: LearningStatus): string {
  const total = Object.values(s.memories).reduce((a, b) => a + b, 0);
  if (!total) return "No lessons stored yet.";
  const agents = Object.values(s.memories).filter((n) => n > 0).length;
  return `${total} lesson${total === 1 ? "" : "s"} across ${agents} agent${agents === 1 ? "" : "s"}.`;
}
