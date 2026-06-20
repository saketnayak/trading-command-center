import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPortfolioSyncQueryKeys,
  buildPortfolioPrefetchQueryKeys,
  allMarketQueryKeys,
} from "./portfolioQueries";

const MARKET_KEYS = allMarketQueryKeys();

test("buildPortfolioSyncQueryKeys includes holdings enrichment keys", () => {
  const keys = buildPortfolioSyncQueryKeys({
    portfolioId: "p1",
    activeTab: "holdings",
    markovEnabled: true,
    waveEnabled: true,
  });

  assert.deepEqual(keys, [
    ["portfolios"],
    ["portfolio-current", "p1"],
    ["portfolio-fundamentals", "p1"],
    ["behavioralAlerts", "p1"],
    ["portfolio-regime", "p1"],
    ["portfolio-trim-signals", "p1"],
    ["portfolio-wave", "p1"],
    ["portfolio-news", "p1"],
    ["portfolio-earnings", "p1"],
    ...MARKET_KEYS,
  ]);
});

test("buildPortfolioSyncQueryKeys adds tab-specific keys", () => {
  const keys = buildPortfolioSyncQueryKeys({
    portfolioId: "p1",
    activeTab: "insights",
    markovEnabled: false,
    waveEnabled: false,
  });

  assert.deepEqual(keys, [
    ["portfolios"],
    ["portfolio-current", "p1"],
    ["portfolio-fundamentals", "p1"],
    ["behavioralAlerts", "p1"],
    ["portfolio-news", "p1"],
    ["portfolio-earnings", "p1"],
    ...MARKET_KEYS,
    ["insight-latest", "p1"],
    ["insights-list", "p1"],
  ]);
});

test("buildPortfolioPrefetchQueryKeys includes default enrichment keys", () => {
  const keys = buildPortfolioPrefetchQueryKeys("p1");

  assert.deepEqual(keys, [
    ["portfolios"],
    ["portfolio-current", "p1"],
    ["portfolio-fundamentals", "p1"],
    ["behavioralAlerts", "p1"],
    ["portfolio-regime", "p1"],
    ["portfolio-trim-signals", "p1"],
    ["portfolio-wave", "p1"],
    ["portfolio-news", "p1"],
    ["portfolio-earnings", "p1"],
    ...MARKET_KEYS,
  ]);
});

test("buildPortfolioPrefetchQueryKeys respects feature flags", () => {
  const keys = buildPortfolioPrefetchQueryKeys("p1", {
    markovEnabled: false,
    waveEnabled: false,
  });

  assert.deepEqual(keys, [
    ["portfolios"],
    ["portfolio-current", "p1"],
    ["portfolio-fundamentals", "p1"],
    ["behavioralAlerts", "p1"],
    ["portfolio-news", "p1"],
    ["portfolio-earnings", "p1"],
    ...MARKET_KEYS,
  ]);
});

test("buildPortfolioPrefetchQueryKeys can skip earnings", () => {
  const keys = buildPortfolioPrefetchQueryKeys("p1", {
    markovEnabled: false,
    waveEnabled: false,
    includeEarnings: false,
  });

  assert.deepEqual(keys, [
    ["portfolios"],
    ["portfolio-current", "p1"],
    ["portfolio-fundamentals", "p1"],
    ["behavioralAlerts", "p1"],
    ["portfolio-news", "p1"],
    ...MARKET_KEYS,
  ]);
});
