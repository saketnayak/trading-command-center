import type { PortfolioHoldingLastRun } from "@/lib/types";

export interface HoldingAnalysisSummary {
  run_id: string;
  verdict: "buy" | "sell" | "hold";
  completed_at: string;
}

const VALID_VERDICTS = new Set(["buy", "sell", "hold"]);

export function analysisFromLastRun(
  lastRun: PortfolioHoldingLastRun | null | undefined
): HoldingAnalysisSummary | null {
  if (!lastRun) return null;
  const verdict = lastRun.verdict.toLowerCase();
  if (!VALID_VERDICTS.has(verdict)) return null;
  return {
    run_id: lastRun.run_id,
    verdict: verdict as HoldingAnalysisSummary["verdict"],
    completed_at: lastRun.analysis_date,
  };
}
