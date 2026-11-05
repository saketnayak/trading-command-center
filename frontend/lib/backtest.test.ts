import { describe, expect, it } from "vitest";
import { cutoffAdvice, cutoffFor, decisionDates, equityCurve, parseTickers, type BacktestTrade } from "./backtest";

const CUTOFFS = { "gpt-4o": "2023-10-01", "gpt-4o-mini": "2023-10-01", "gpt-5": "2024-09-30", "gpt-5-mini": "2024-05-31" };

describe("backtest helpers", () => {
  it("finds the cutoff by longest prefix", () => {
    expect(cutoffFor("gpt-5-mini-2025-08-07", CUTOFFS)).toBe("2024-05-31");
    expect(cutoffFor("openai/gpt-5", CUTOFFS)).toBe("2024-09-30");
    expect(cutoffFor("llama-local", CUTOFFS)).toBeNull();
    expect(cutoffFor("gpt-5.5", CUTOFFS)).toBeNull();
    expect(cutoffFor("gpt-4o-2024-08-06", CUTOFFS)).toBe("2023-10-01");
  });

  it("builds the decision grid like the harness", () => {
    expect(decisionDates("2024-01-01", "2024-01-31", "weekly")).toEqual(["2024-01-05", "2024-01-12", "2024-01-19", "2024-01-26"]);
    expect(decisionDates("2024-01-01", "2024-01-03", "weekly")).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
    expect(decisionDates("2024-01-01", "2024-01-07", "daily")).toHaveLength(5);
    expect(decisionDates("2024-02-01", "2024-01-01", "daily")).toEqual([]);
  });

  it("explains the dates against the cutoff", () => {
    expect(cutoffAdvice("2024-01-01", "2024-06-30", "2023-10-01").tone).toBe("ok");
    expect(cutoffAdvice("2023-01-01", "2023-06-30", "2023-10-01").text).toMatch(/no headline score/);
    expect(cutoffAdvice("2023-06-01", "2024-06-30", "2023-10-01").text).toMatch(/reported separately/);
    expect(cutoffAdvice("2023-06-01", "2024-06-30", null).tone).toBe("warn");
  });

  it("parses tickers", () => {
    expect(parseTickers(" aapl, msft;nvda  aapl ")).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("builds an equal-weight equity curve per date", () => {
    const t = (d: string, r: number, notes = "") => ({ decision_date: d, realised_return: r, entry_price: 1, exit_price: 1, notes,
      benchmark_returns: { buy_and_hold: 0.01 } }) as unknown as BacktestTrade;
    const curve = equityCurve([t("2024-01-12", 0.02), t("2024-01-05", 0.1), t("2024-01-05", -0.1), t("2024-01-19", 5, "propagate error")],
      (x) => x.realised_return);
    expect(curve.dates).toEqual(["2024-01-05", "2024-01-12"]);
    expect(curve.values[0]).toBeCloseTo(1);
    expect(curve.values[1]).toBeCloseTo(1.02);
    expect(equityCurve([t("2024-01-05", 0)], (x) => x.benchmark_returns.buy_and_hold).values).toEqual([1.01]);
  });
});
