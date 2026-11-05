import { describe, expect, it } from "vitest";
import { briefLine, compactMoney, digestNote, filterFilings, insiderLine, type Filing, type InsiderSummary } from "./filings";

const filing = (over: Partial<Filing>): Filing => ({
  accession: "a", ticker: "NVDA", form: "10-Q", filed_date: "2026-10-30", report_date: null, url: "u", items: [],
  notable: false, summary: null, counts: null, prev: null, digest: null, digest_status: "done", ...over,
});
const insider = (over: Partial<InsiderSummary>): InsiderSummary => ({
  ticker: "NVDA", buys: 0, sells: 0, buy_value: 0, sell_value: 0, net_value: 0, planned_sells: 0, planned_sell_value: 0,
  buyers: [], sellers: [], other_transactions: 0, recent: [], ...over,
});

describe("filings helpers", () => {
  it("formats money compactly", () => {
    expect(compactMoney(950)).toBe("$950");
    expect(compactMoney(80_000)).toBe("$80k");
    expect(compactMoney(-2_500_000)).toBe("$2.5M");
    expect(compactMoney(3.2e9)).toBe("$3.2B");
  });

  it("filters by form", () => {
    const fs = [filing({ form: "10-K" }), filing({ form: "8-K" }), filing({ form: "10-Q" })];
    expect(filterFilings(fs, "periodic").map((f) => f.form)).toEqual(["10-K", "10-Q"]);
    expect(filterFilings(fs, "current").map((f) => f.form)).toEqual(["8-K"]);
    expect(filterFilings(fs, "all")).toHaveLength(3);
  });

  it("explains a missing digest", () => {
    expect(digestNote(filing({ digest_status: "prepared" }), true)).toBe("AI summary on the next refresh.");
    expect(digestNote(filing({ digest_status: "prepared" }), false)).toBeNull();
    expect(digestNote(filing({ digest_status: "uncited" }), true)).toMatch(/didn't quote/);
    expect(digestNote(filing({ digest_status: "not_applicable" }), true)).toBeNull();
    expect(digestNote(filing({ digest: { headline: "h", points: [], model: null } }), true)).toBeNull();
  });

  it("summarises insider activity", () => {
    expect(insiderLine(insider({ buys: 1, buy_value: 80_000 }))).toBe("1 buy ($80k)");
    expect(insiderLine(insider({ sells: 3, sell_value: 2.5e6, planned_sells: 3 }))).toBe("3 sells ($2.5M), all under 10b5-1 plans");
    expect(insiderLine(insider({ buys: 2, buy_value: 1e6, sells: 3, sell_value: 4e5, planned_sells: 1 }))).toBe(
      "2 buys ($1.0M) · 3 sells ($400k), 1 under 10b5-1 plans",
    );
    expect(insiderLine(insider({ other_transactions: 4 }))).toBe("No open-market trades");
  });

  it("builds the morning brief line, notable filings first", () => {
    const r = {
      filings: [
        filing({ ticker: "AMD", form: "8-K", items: [{ item: "7.01", label: "Regulation FD disclosure", notable: false }] }),
        filing({ ticker: "NVDA", form: "10-Q" }),
        filing({ ticker: "INTC", form: "8-K", notable: true, items: [{ item: "5.02", label: "Director or officer change, or pay arrangement", notable: true }] }),
      ],
      insiders: [insider({ ticker: "NVDA", sells: 2, sell_value: 3e6 }), insider({ ticker: "AMD", buys: 1, buy_value: 5e4 })],
    };
    expect(briefLine(r)).toBe(
      "NVDA 10-Q · INTC 8-K (director or officer change, or pay arrangement) · 1 more filing · insiders bought $50k of AMD · insiders sold $3.0M of NVDA",
    );
    expect(briefLine({ filings: [], insiders: [insider({ other_transactions: 2 })] })).toBeNull();
  });
});
