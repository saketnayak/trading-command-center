import { describe, expect, it } from "vitest";
import { guessMapping, mapRows, normaliseType, parseCsv, parseDate, parseNumber } from "./ledger";

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
