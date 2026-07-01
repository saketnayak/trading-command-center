import { describe, expect, it } from "vitest";
import {
  buildPortfolioTabGroups,
  isOverflowPortfolioTab,
  isPortfolioTab,
  legacyPortfolioTabRedirect,
  resolvePortfolioTab,
} from "./portfolioTabs";

describe("portfolioTabs", () => {
  it("recognizes valid tab ids", () => {
    expect(isPortfolioTab("holdings")).toBe(true);
    expect(isPortfolioTab("trending")).toBe(false);
    expect(isPortfolioTab("invalid")).toBe(false);
  });

  it("splits primary and overflow tabs", () => {
    const groups = buildPortfolioTabGroups({ allCrypto: false });
    expect(groups.primary.map((t) => t.id)).toEqual(["holdings", "insights", "earnings", "news"]);
    expect(groups.overflow.map((t) => t.id)).toEqual(["chat", "thesis"]);
  });

  it("hides earnings when portfolio is all crypto", () => {
    const groups = buildPortfolioTabGroups({ allCrypto: true });
    expect(groups.overflow.some((t) => t.id === "earnings")).toBe(false);
    expect(resolvePortfolioTab("earnings", { allCrypto: true })).toBe("holdings");
  });

  it("falls back to holdings for unknown tabs", () => {
    expect(resolvePortfolioTab("nope", { allCrypto: false })).toBe("holdings");
  });

  it("marks overflow tabs correctly", () => {
    expect(isOverflowPortfolioTab("chat", { allCrypto: false })).toBe(true);
    expect(isOverflowPortfolioTab("news", { allCrypto: false })).toBe(false);
    expect(isOverflowPortfolioTab("holdings", { allCrypto: false })).toBe(false);
  });

  it("redirects legacy market tabs to /market", () => {
    expect(legacyPortfolioTabRedirect("trending")).toBe("/market");
    expect(legacyPortfolioTabRedirect("discover")).toBe("/market?tab=discover");
    expect(legacyPortfolioTabRedirect("holdings")).toBeNull();
  });
});
