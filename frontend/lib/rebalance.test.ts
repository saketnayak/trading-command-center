import { describe, expect, it } from "vitest";
import {
  draftProblem,
  draftSum,
  draftsFromCurrent,
  draftsToTargets,
  equalWeightDrafts,
  normaliseDrafts,
  planCsv,
  type DriftRow,
  type RebalancePlan,
} from "./rebalance";

const row = (ticker: string, weight: number): DriftRow => ({
  ticker, shares: 1, price: 1, value: 1, weight, target: 0, band: 0.05, drift: 0, status: "untargeted",
});

describe("rebalance helpers", () => {
  it("normalises to exactly 100% with two decimals", () => {
    const thirds = equalWeightDrafts(["A", "B", "C"]);
    expect(thirds.map((d) => d.pct)).toEqual(["33.34", "33.33", "33.33"]);
    expect(draftSum(thirds)).toBeCloseTo(100, 6);
    expect(normaliseDrafts([{ ticker: "A", pct: "30" }, { ticker: "B", pct: "30" }]).map((d) => d.pct)).toEqual(["50", "50"]);
  });

  it("seeds targets from current weights, skipping target-only rows", () => {
    const drafts = draftsFromCurrent([row("A", 0.6), row("B", 0.4), row("N", 0)]);
    expect(drafts).toEqual([{ ticker: "A", pct: "60" }, { ticker: "B", pct: "40" }]);
  });

  it("validates drafts", () => {
    expect(draftProblem([{ ticker: "A", pct: "60" }, { ticker: "b", pct: "40" }])).toBeNull();
    expect(draftProblem([{ ticker: "A", pct: "60" }, { ticker: "a", pct: "40" }])).toBe("A appears twice.");
    expect(draftProblem([{ ticker: "A", pct: "" }])).toBe("Enter a percentage for A.");
    expect(draftProblem([{ ticker: "A", pct: "60" }, { ticker: "B", pct: "30" }])).toBe("Targets add up to 90.00%, not 100%.");
    expect(draftProblem([{ ticker: "", pct: "" }])).toBeNull(); // blank rows are ignored
  });

  it("converts drafts to API rows", () => {
    expect(draftsToTargets([{ ticker: " aapl ", pct: "25.5" }, { ticker: "", pct: "1" }], 0.05)).toEqual([
      { ticker: "AAPL", weight: 0.255, band: 0.05 },
    ]);
    expect(draftsToTargets([{ ticker: "A", pct: "21.74" }], 0.05)[0].weight).toBe(0.2174);
  });

  it("exports the plan as CSV", () => {
    const plan = {
      trades: [{ ticker: "A", action: "sell", amount: 1000, shares: 10, price: 100, weight_before: 0.6, weight_after: 0.5 }],
    } as RebalancePlan;
    expect(planCsv(plan, "USD")).toBe(
      "ticker,action,shares,price,amount_USD,weight_before,weight_after\nA,sell,10,100,1000,0.6,0.5\n",
    );
  });
});
