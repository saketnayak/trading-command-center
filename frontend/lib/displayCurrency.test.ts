import assert from "node:assert/strict";
import { test } from "node:test";

import { formatRate, orderCurrencies, rateLine, rowMoney, sortValue, withCurrency } from "./displayCurrency";
import type { PortfolioHolding } from "./types";
import { portfolioQueryKeys } from "./portfolioQueries";

test("withCurrency appends to bare and existing query strings", () => {
  assert.equal(withCurrency("/net-worth?range=1y", "AUD"), "/net-worth?range=1y&currency=AUD");
  assert.equal(withCurrency("/portfolio/p/xray", "EUR"), "/portfolio/p/xray?currency=EUR");
  assert.equal(withCurrency("/portfolio/p/xray", null), "/portfolio/p/xray");
  assert.equal(withCurrency("/portfolio/p/xray", undefined), "/portfolio/p/xray");
});

test("orderCurrencies puts held currencies first, once", () => {
  assert.deepEqual(orderCurrencies(["AUD", "EUR", "USD"], ["USD", "AUD", "USD"]), { held: ["AUD", "USD"], others: ["EUR"] });
  assert.deepEqual(orderCurrencies(["AUD", "USD"], ["HKD"]), { held: [], others: ["AUD", "USD"] });
});

test("rateLine labels live, ECB and stale", () => {
  const now = new Date("2026-01-02T15:02:00Z");
  assert.equal(
    rateLine({ source: "live", as_of: "2026-01-02T15:00:00Z", rates_used: { USD: 1.52341 } }, "AUD", now)?.text,
    "1 USD = 1.5234 AUD · live · 2 min ago",
  );
  assert.equal(
    rateLine({ source: "ecb", as_of: "2025-11-07T00:00:00Z", rates_used: { USD: 1.5 } }, "AUD", now)?.text,
    "1 USD = 1.5000 AUD · ECB daily · 7 Nov",
  );
  const stale = rateLine({ source: "stale", as_of: "2026-01-02T12:00:00Z", rates_used: { USD: 1.5 } }, "AUD", now);
  assert.equal(stale?.text, "1 USD = 1.5000 AUD · stale · 3 h ago");
  assert.equal(stale?.tone, "amber");
  assert.equal(rateLine({ source: "live", as_of: null, rates_used: {} }, "USD", now), null);
  assert.equal(rateLine(null, "USD", now), null);
});

test("rateLine picks the primary pair and lists every pair", () => {
  const now = new Date("2026-01-02T15:00:30Z");
  const line = rateLine(
    { source: "live", as_of: "2026-01-02T15:00:00Z", rates_used: { EUR: 1.7, USD: 1.5 } }, "AUD", now, "USD");
  assert.equal(line?.text, "1 USD = 1.5000 AUD · live · just now");
  assert.deepEqual(line?.pairs, ["1 EUR = 1.7000 AUD", "1 USD = 1.5000 AUD"]);
});

test("rateLine keeps significant digits for tiny rates", () => {
  assert.equal(formatRate(0.000712345), "0.0007123");
  assert.equal(formatRate(0.6667), "0.6667");
  assert.equal(formatRate(1402.5), "1402.5000");
});

test("keys carry the currency so responses cannot cross", () => {
  assert.notDeepEqual(portfolioQueryKeys.current("p", "AUD"), portfolioQueryKeys.current("p", "USD"));
  assert.deepEqual(portfolioQueryKeys.current("p"), ["portfolio-current", "p"]);
  assert.deepEqual(portfolioQueryKeys.current("p", "AUD"), ["portfolio-current", "p", "AUD"]);
  assert.deepEqual(portfolioQueryKeys.performance("p", "auto", "1y", "SPY", "EUR"),
    ["portfolio-performance", "p", "auto", "1y", "SPY", "EUR"]);
});

const holding = {
  quote_currency: "USD", current_price: 200, current_price_display: 300, market_value: 2000, market_value_display: 3000,
  unrealized_pnl: null, unrealized_pnl_display: 300, unrealized_pnl_pct: null, unrealized_pnl_pct_display: 11.1,
  pnl_unavailable_reason: "currency_mismatch",
} as PortfolioHolding;

test("rowMoney shows the display value with native subtext only when currencies differ", () => {
  assert.deepEqual(rowMoney(holding, "market_value", false, "AUD"),
    { value: 3000, currency: "AUD", native: { value: 2000, currency: "USD" } });
  assert.equal(rowMoney(holding, "market_value", false, "USD").native, null);
  assert.deepEqual(rowMoney(holding, "market_value", true, "AUD"), { value: 2000, currency: "USD", native: null });
  assert.deepEqual(rowMoney(holding, "unrealized_pnl", false, "AUD"), { value: 300, currency: "AUD", native: null });
});

test("sortValue sorts on converted values unless native is on", () => {
  assert.equal(sortValue(holding, "market_value", false), 3000);
  assert.equal(sortValue(holding, "unrealized_pnl_pct", false), 11.1);
  assert.equal(sortValue(holding, "unrealized_pnl", true), null);
});
