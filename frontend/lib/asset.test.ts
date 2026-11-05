import { describe, expect, it } from "vitest";

import { cryptoBase, fmtCoinCount, quantityUnit } from "./asset";

describe("crypto units", () => {
  it("names the coin a crypto position is counted in", () => {
    expect(cryptoBase("BTC-USD")).toBe("BTC");
    expect(cryptoBase("eth-usdc")).toBe("ETH");
    expect(cryptoBase("BRK-B")).toBe("BRK-B");
    expect(quantityUnit("BTC-USD")).toBe("BTC");
    expect(quantityUnit("AAPL")).toBe("sh");
    expect(quantityUnit("BRK-B")).toBe("sh");
  });

  it("counts coins, not dollars", () => {
    expect(fmtCoinCount(20_110_000, "BTC")).toBe("20.11M BTC");
    expect(fmtCoinCount(21_000_000, "BTC")).toBe("21.00M BTC");
    expect(fmtCoinCount(120_500, "ETH")).toBe("120.5K ETH");
    expect(fmtCoinCount(950.25, "XYZ")).toBe("950.25 XYZ");
    expect(fmtCoinCount(null, "BTC")).toBeNull();
  });
});
