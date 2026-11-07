import { describe, expect, it } from "vitest";

import { scopedFinnhubMessage } from "./finnhubMessages";

const ASX = ["AMP.AX", "CSL.AX", "ELV.AX", "FMG.AX", "LOV.AX", "NAB.AX", "NDQ.AX", "PLS.AX"];

describe("scopedFinnhubMessage", () => {
  it("names the holdings when only some were refused", () => {
    expect(scopedFinnhubMessage("access_denied", "fundamentals", ASX, 39)).toBe(
      "Your Finnhub API key cannot access fundamentals for 8 of 39 holdings: AMP.AX, CSL.AX, ELV.AX, FMG.AX and 4 more. Prices are unaffected.",
    );
    expect(scopedFinnhubMessage("access_denied", "fundamentals", ["CSL.AX"], 5)).toBe(
      "Your Finnhub API key cannot access fundamentals for 1 of 5 holdings: CSL.AX. Prices are unaffected.",
    );
  });

  it("keeps the plain message when every holding, or none named, is affected", () => {
    expect(scopedFinnhubMessage("access_denied", "fundamentals", ["A", "B"], 2)).toBe(
      "Your Finnhub API key cannot access fundamentals.",
    );
    expect(scopedFinnhubMessage("premium_required", "fundamentals", [], 10)).toBe(
      "Your Finnhub plan does not include fundamentals. Upgrade to Premium Access on Finnhub.",
    );
    expect(scopedFinnhubMessage(null, "fundamentals", ASX, 39)).toBeNull();
  });
});
