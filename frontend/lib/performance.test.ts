import { describe, expect, it } from "vitest";
import {
  fmtPct,
  fmtSignedPct,
  isValidBenchmark,
  performanceHeadline,
  performanceQueryParams,
  type PortfolioPerformance,
} from "./performance";

function perf(total: number | null, bench: number | null): PortfolioPerformance {
  const stats = (t: number | null) =>
    t == null
      ? null
      : {
          total_return: t, annualised_return: null, volatility: null, sharpe: null, max_drawdown: null,
          max_drawdown_peak: null, max_drawdown_trough: null, best_day: null, worst_day: null,
        };
  return {
    portfolio_id: "p", mode: "actual", range: "1y", benchmark: "SPY", display_currency: "USD",
    methodology: "", history_days: 400, warnings: [], start: null, end: null, series: [],
    stats: stats(total), benchmark_stats: stats(bench), period_returns: null,
    benchmark_period_returns: null, holdings: [], message: null,
  };
}

describe("performance helpers", () => {
  it("formats signed and unsigned percentages", () => {
    expect(fmtSignedPct(0.0523)).toBe("+5.23%");
    expect(fmtSignedPct(-0.1)).toBe("−10.00%");
    expect(fmtSignedPct(0)).toBe("0.00%");
    expect(fmtSignedPct(null)).toBe("—");
    expect(fmtPct(0.183)).toBe("18.3%");
  });

  it("writes a plain-English headline against the benchmark", () => {
    expect(performanceHeadline(perf(0.12, 0.08))).toBe("You beat SPY by 4.00% (+12.00% vs +8.00%).");
    expect(performanceHeadline(perf(0.02, 0.08))).toBe("You trailed SPY by 6.00% (+2.00% vs +8.00%).");
    expect(performanceHeadline(perf(0.05, null))).toBe("Your portfolio returned +5.00% over this period.");
    expect(performanceHeadline(perf(null, 0.05))).toBeNull();
    expect(performanceHeadline(perf(0.0801, 0.08))).toContain("In line with SPY");
  });

  it("builds query params and validates benchmarks like the backend", () => {
    expect(performanceQueryParams("auto", "1y", " qqq ")).toBe("mode=auto&range=1y&benchmark=QQQ");
    expect(isValidBenchmark("BTC-USD")).toBe(true);
    expect(isValidBenchmark("^GSPC")).toBe(false); // must start alphanumeric
    expect(isValidBenchmark("SP Y")).toBe(false);
  });
});
