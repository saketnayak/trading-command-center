import { describe, expect, it } from "vitest";

import { hiddenExposures, overlapOpacity, pct, sourceLabel, viaLine, visibleExposures } from "./xray";

const row = (ticker: string, via: number[]) => ({
  key: ticker,
  ticker,
  name: ticker,
  direct: 0.1,
  total: 0.1,
  via: via.map((weight, i) => ({ fund: `F${i}`, weight })),
});

describe("xray helpers", () => {
  it("formats fractions as percentages", () => {
    expect(pct(0.0942)).toBe("9.4%");
    expect(pct(null)).toBe("—");
  });

  it("names where a fund's holdings came from", () => {
    expect(sourceLabel({ source: "sec_nport", as_of: "2026-06-30", holdings_known: 90 })).toBe("SEC filing, 2026-06-30");
    expect(sourceLabel({ source: "yahoo_top10", as_of: null, holdings_known: 10 })).toBe("Yahoo, top holdings only");
    expect(sourceLabel({ source: "yahoo_top10", as_of: null, holdings_known: 0 })).toBe("No company holdings reported");
    expect(sourceLabel({ source: null, as_of: null, holdings_known: 0 })).toBe("No holdings data yet");
  });

  it("keeps only exposures that run through a fund", () => {
    const rows = [row("A", []), row("B", [0.1]), row("C", [0.1]), row("D", [0.1]), row("E", [0.1])];
    expect(hiddenExposures(rows).map((r) => r.ticker)).toEqual(["B", "C", "D"]);
  });

  it("hides exposures that would round to 0.0%", () => {
    const rows = [{ ...row("A", []), total: 0.0005 }, { ...row("B", []), total: 0.0004 }];
    expect(visibleExposures(rows).map((r) => r.ticker)).toEqual(["A"]);
  });

  it("lists the funds behind an exposure", () => {
    expect(viaLine(row("A", [0.05, 0.012]).via)).toBe("F0 5.0%, F1 1.2%");
  });

  it("clamps overlap shading", () => {
    expect(overlapOpacity(0)).toBe(0);
    expect(overlapOpacity(0.5)).toBe(0.35);
    expect(overlapOpacity(2)).toBe(0.7);
  });
});
