import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";

import { headline, pnlNote } from "./displayCurrency";
import { samePortfolioPlaceholder } from "./portfolioQueries";
import { computeFreshnessLabel } from "./usePortfolioFreshness";
import type { PortfolioCurrentResponse, PortfolioHolding } from "./types";

test("placeholder data never crosses portfolios", () => {
  const keep = samePortfolioPlaceholder("B");
  assert.equal(keep({ x: 1 }, { queryKey: ["portfolio-current", "A", "AUD"] }), undefined);
  assert.deepEqual(keep({ x: 1 }, { queryKey: ["portfolio-current", "B", "USD"] }), { x: 1 });
  assert.equal(keep(undefined, undefined), undefined);
});

test("freshness label sees queries keyed by currency", () => {
  const qc = new QueryClient();
  const now = Date.now();
  qc.setQueryData(["portfolio-current", "p", "AUD"], { ok: true }, { updatedAt: now - 30_000 });
  assert.equal(computeFreshnessLabel("p", false, false, false, qc, now), "Updated 30s ago");
});

test("headline shows (with its picker) whenever a snapshot is loaded, even with no totals", () => {
  const noTotals = { snapshot: { id: "s" }, display_currency: "AUD", totals_currency: null,
    totals: { market_value: null, unrealized_pnl: null, unrealized_pnl_pct: null } } as unknown as PortfolioCurrentResponse;
  assert.deepEqual(headline(noTotals), { show: true, currency: "AUD" });
  assert.deepEqual(headline({ ...noTotals, snapshot: null } as PortfolioCurrentResponse), { show: false, currency: "AUD" });
  assert.deepEqual(headline(undefined), { show: false, currency: "USD" });
});

test("P&L note only claims a conversion when the cost currency differs from the display currency", () => {
  const h = { pnl_unavailable_reason: "currency_mismatch", cost_basis_currency: "AUD", quote_currency: "USD" } as PortfolioHolding;
  assert.equal(pnlNote(h, "AUD"), "Cost is in AUD; the value converts at today's rate, so currency moves are included.");
  assert.equal(pnlNote(h, "EUR"), "Cost converted at today's rate; currency moves since purchase are not included.");
  assert.equal(pnlNote({ ...h, pnl_unavailable_reason: null } as PortfolioHolding, "EUR"), undefined);
});
