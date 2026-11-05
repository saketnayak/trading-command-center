import { describe, expect, it } from "vitest";
import { taxHeadline, taxRowsCsv, washRiskText, type HarvestCandidate, type TaxReport, type TaxRow } from "./tax";

const row: TaxRow = {
  date_sold: "2026-07-28", date_acquired: "2025-06-23", symbol: "AAA", account: "Joint, taxable", currency: "USD",
  quantity: 10, proceeds: 800, cost: 1000, gain: -200, term: "long", code: "W", adjustment: 100, adjusted_gain: -100,
  replacements: [],
};
const totals = { currency: "USD", net: -100,
  short: { proceeds: 0, cost: 0, gain: 0, adjustment: 0, adjusted_gain: 0 },
  long: { proceeds: 800, cost: 1000, gain: -200, adjustment: 100, adjusted_gain: -100 } };

describe("tax helpers", () => {
  it("writes Form 8949-style CSV with escaping", () => {
    const csv = taxRowsCsv([row]).trim().split("\n");
    expect(csv[0]).toBe("description,date_acquired,date_sold,proceeds,cost_basis,adjustment_code,adjustment,gain_or_loss,term,account,currency");
    expect(csv[1]).toBe('10 AAA,2025-06-23,2026-07-28,800.00,1000.00,W,100.00,-100.00,long,"Joint, taxable",USD');
  });

  it("summarises the year", () => {
    const r = { year: 2026, report: { year: 2026, rows: [row], totals: [totals] }, wash_sales: [row] } as unknown as TaxReport;
    expect(taxHeadline(r)).toBe("2026: $100.00 net loss realised, after 1 wash sale.");
    expect(taxHeadline({ ...r, report: { year: 2026, rows: [], totals: [] } })).toBeNull();
  });

  it("names the latest recent buy as the wash-sale risk", () => {
    const c = { recent_buys: [
      { date: "2026-10-30", account: "Main", portfolio: "Second", quantity: 1 },
      { date: "2026-10-20", account: "IRA", portfolio: "Core", quantity: 2 }] } as HarvestCandidate;
    expect(washRiskText(c)).toBe("Bought 1 on 2026-10-30 (Second / Main): selling at a loss now would be a wash sale.");
    expect(washRiskText({ ...c, recent_buys: [] })).toBeNull();
  });
});
