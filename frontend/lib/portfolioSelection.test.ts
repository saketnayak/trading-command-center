import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePortfolioId } from "./portfolioSelection";

const portfolios = [{ id: "a" }, { id: "b" }];

test("resolvePortfolioId returns null for empty list", () => {
  assert.equal(resolvePortfolioId([], "a"), null);
});

test("resolvePortfolioId prefers valid preferred id", () => {
  assert.equal(resolvePortfolioId(portfolios, "b"), "b");
});

test("resolvePortfolioId falls back to first portfolio when preferred is stale", () => {
  assert.equal(resolvePortfolioId(portfolios, "missing"), "a");
});

test("resolvePortfolioId falls back to first portfolio when preferred is null", () => {
  assert.equal(resolvePortfolioId(portfolios, null), "a");
});
