import { describe, expect, it } from "vitest";
import { clusterSentence, riskOutlier, stressMethod, varHeadline, type PortfolioRisk, type StressResult } from "./risk";

const stress = (replayed: number, source: StressResult["market_source"] = "stored prices"): StressResult => ({
  id: "x", name: "X", start: "2022-01-03", end: "2022-10-12", note: "", market_return: -0.25,
  market_source: source, portfolio_return: -0.3, portfolio_impact: -300, replayed_weight: replayed, worst: [],
});

describe("risk helpers", () => {
  it("writes the VaR headline in money and percent", () => {
    const r = {
      display_currency: "USD",
      risk: { stats: { var_95: 0.021, var_95_value: 420 } },
    } as unknown as PortfolioRisk;
    expect(varHeadline(r)).toBe("On a bad day (1 in 20), this portfolio could lose about $420.00 (2.1%) or more.");
    expect(varHeadline({ ...r, risk: null } as PortfolioRisk)).toBeNull();
  });

  it("describes clusters", () => {
    expect(clusterSentence({ tickers: ["NVDA", "AMD"], combined_weight: 0.42, average_correlation: 0.86 })).toBe(
      "NVDA + AMD move together (average correlation 0.86): 42% of your value behaves like one position.",
    );
    expect(clusterSentence({ tickers: ["A", "B", "C", "D", "E"], combined_weight: 0.5, average_correlation: 0.9 })).toContain(
      "A, B, C and 2 more",
    );
  });

  it("labels how a stress row was built", () => {
    expect(stressMethod(stress(1))).toBe("Replayed from real prices");
    expect(stressMethod(stress(0, "S&P 500 index levels"))).toBe("Estimated: beta × S&P 500 index move");
    expect(stressMethod(stress(0.6))).toBe("60% replayed, rest estimated from beta");
  });

  it("finds the holding whose risk share most exceeds its weight", () => {
    expect(
      riskOutlier([
        { ticker: "A", weight: 0.5, risk_share: 0.3, volatility: null, beta: null },
        { ticker: "B", weight: 0.2, risk_share: 0.55, volatility: null, beta: null },
        { ticker: "C", weight: 0.3, risk_share: 0.15, volatility: null, beta: null },
      ])?.ticker,
    ).toBe("B");
    expect(riskOutlier([{ ticker: "A", weight: 0.5, risk_share: 0.52, volatility: null, beta: null }])).toBeNull();
  });
});
