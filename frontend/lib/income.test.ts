import { describe, expect, it } from "vitest";
import { addMonths, fillMonths, goalText, incomeHeadline, monthLabel, projectionSummary, type IncomeReport } from "./income";

const report = (monthly: number, target: number | null): IncomeReport =>
  ({
    display_currency: "USD",
    target_monthly: target,
    totals: { annual_income: monthly * 12, monthly_income: monthly, payers: 2, holdings: 3 },
  }) as unknown as IncomeReport;

describe("income helpers", () => {
  it("labels months", () => {
    expect(monthLabel("2026-11")).toBe("Nov");
    expect(monthLabel("2027-01", true)).toBe("Jan 2027");
  });

  it("writes the headline", () => {
    expect(incomeHeadline(report(50, null))).toBe("About $600.00 a year ($50.00 a month) from 2 of 3 holdings.");
    expect(incomeHeadline(report(0, null))).toBeNull();
  });

  it("describes goal progress, capped for the bar", () => {
    expect(goalText(report(50, null))).toBeNull();
    expect(goalText(report(25, 100))).toEqual({ pct: 0.25, text: "25% of your $100.00 a month goal; $75.00 a month to go." });
    const done = goalText(report(150, 100))!;
    expect(done.pct).toBe(1);
    expect(done.text).toBe("Goal reached: $150.00 a month against a $100.00 target.");
  });

  it("fills month gaps across a year boundary", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(fillMonths([{ month: "2026-10", amount: 5 }, { month: "2025-01", amount: 9 }], "2026-11", 3)).toEqual([
      { month: "2026-09", amount: 0 },
      { month: "2026-10", amount: 5 },
      { month: "2026-11", amount: 0 },
    ]);
  });

  it("summarises the projection", () => {
    const r = { ...report(50, null), projection: { growth: 0.05, yield: 0.03, years: [
      { year: 0, without_drip: 600, with_drip: 600 }, { year: 10, without_drip: 977.34, with_drip: 1313.47 }] } } as IncomeReport;
    expect(projectionSummary(r)).toContain("grow 5.0% a year");
    expect(projectionSummary(r)).toContain("In 10 years: $977.34 a year taken as cash, or $1,313.47");
    expect(projectionSummary(report(50, null))).toBeNull();
  });
});
