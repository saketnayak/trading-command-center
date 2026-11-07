import { describe, expect, it } from "vitest";
import { guessMapping, inputsFromPicks, mapRows, normaliseType, parseCsv, parseDate, parseNumber, pickSummary, picksFromInputs } from "./ledger";

describe("ledger CSV helpers", () => {
  it("parses quoted CSV with commas, escaped quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"1,000","say ""hi"""\n\n3,4')).toEqual([["a", "b"], ["1,000", 'say "hi"'], ["3", "4"]]);
  });

  it("guesses columns from common broker headers", () => {
    const m = guessMapping(["Run Date", "Action", "Symbol", "Quantity", "Price ($)", "Commission ($)", "Amount ($)", "Account"]);
    expect(m).toEqual({ trade_date: 0, type: 1, symbol: 2, quantity: 3, price: 4, fees: 5, amount: 6, account: 7 });
  });

  it("normalises broker wording to ledger types", () => {
    expect(normaliseType("YOU BOUGHT")).toBe("BUY");
    expect(normaliseType("Sold")).toBe("SELL");
    expect(normaliseType("Qualified Dividend")).toBe("DIVIDEND");
    expect(normaliseType("Credit Interest")).toBe("INTEREST");
    expect(normaliseType("Contribution")).toBe("DEPOSIT");
    expect(normaliseType("2:1 stock split")).toBe("SPLIT");
    expect(normaliseType("journal")).toBeNull();
  });

  it("parses money and dates", () => {
    expect(parseNumber("$1,234.50")).toBe(1234.5);
    expect(parseNumber("(12.30)")).toBe(-12.3);
    expect(parseNumber("")).toBeUndefined();
    expect(parseDate("2026-3-5")).toBe("2026-03-05");
    expect(parseDate("03/05/2026")).toBe("2026-03-05");
    expect(parseDate("05.03.2026")).toBe("2026-03-05");
    expect(parseDate("yesterday")).toBeNull();
  });

  it("maps rows, takes absolute values and derives a missing price", () => {
    const rows = [
      ["2026-01-02", "Bought", "aapl", "10", "", "", "-1505.00"],
      ["2026-02-01", "Sold", "AAPL", "-4", "160", "1", ""],
      ["2026-03-01", "Dividend", "AAPL", "", "", "", "2.40"],
      ["soon", "Bought", "X", "1", "1", "", ""],
    ];
    const { rows: out, problems } = mapRows(rows, { trade_date: 0, type: 1, symbol: 2, quantity: 3, price: 4, fees: 5, amount: 6 },
      { account: "Main", currency: "USD" });
    expect(problems).toEqual([{ row: 4, error: 'unreadable date "soon"' }]);
    expect(out[0]).toMatchObject({ type: "BUY", symbol: "AAPL", quantity: 10, price: 150.5, amount: 1505 });
    expect(out[1]).toMatchObject({ type: "SELL", quantity: 4, price: 160, fees: 1 });
    expect(out[2]).toMatchObject({ type: "DIVIDEND", amount: 2.4, account: "Main", currency: "USD" });
  });
});

describe("choosing lots for a sale", () => {
  const lots = [
    { buy_id: "a", open_date: "2020-01-02", quantity: 10, cost_per_share: 100, term: "long" as const },
    { buy_id: "b", open_date: "2025-01-02", quantity: 5, cost_per_share: 300, term: "short" as const },
  ];

  it("turns picker inputs into lots, leaving out blanks and zeros", () => {
    expect(picksFromInputs({ a: "4", b: "", c: "0", d: "x" })).toEqual([{ buy_id: "a", quantity: 4 }]);
    expect(inputsFromPicks([{ buy_id: "a", quantity: 4 }])).toEqual({ a: "4" });
    expect(inputsFromPicks(null)).toEqual({});
  });

  it("says what happens to the shares not chosen", () => {
    expect(pickSummary([], 8, "fifo", lots)).toEqual({ text: "No lots chosen; the sale follows FIFO.", ok: true });
    expect(pickSummary([{ buy_id: "a", quantity: 3 }], 8, "fifo", lots).text).toBe("3 of 8 chosen; the other 5 follow FIFO.");
    expect(pickSummary([{ buy_id: "a", quantity: 3 }, { buy_id: "b", quantity: 5 }], 8, "hifo", lots).text).toBe("All 8 chosen.");
  });

  it("flags choices that can't be saved", () => {
    expect(pickSummary([{ buy_id: "b", quantity: 6 }], 8, "fifo", lots).ok).toBe(false);
    expect(pickSummary([{ buy_id: "a", quantity: 9 }], 8, "fifo", lots).ok).toBe(false);
    expect(pickSummary([{ buy_id: "zzz", quantity: 1 }], 8, "fifo", lots).ok).toBe(false);
  });
});
