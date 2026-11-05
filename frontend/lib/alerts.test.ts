import { describe, expect, it } from "vitest";
import {
  ALERT_KINDS,
  analysisLabel,
  canRerun,
  compiledToRequest,
  defaultParams,
  deliveryIssues,
  describeCondition,
  describeRule,
  firingNote,
  needsPortfolio,
  timeAgo,
  toApiParams,
  unsupportedLabel,
} from "./alerts";

describe("alerts helpers", () => {
  it("describes each kind in one sentence", () => {
    const r = (kind: Parameters<typeof describeRule>[0]["kind"], params: Record<string, number | string>, ticker: string | null = "AAPL") =>
      describeRule({ kind, ticker, params, portfolio_name: "Core" });
    expect(r("price_above", { price: 1234.5 })).toBe("AAPL rises above 1,234.5");
    expect(r("price_below", { price: 0.1523 })).toBe("AAPL falls below 0.152");
    expect(r("daily_move", { pct: 5 })).toBe("AAPL moves 5% or more in a day");
    expect(r("ma_cross", { direction: "below", window: 200 })).toBe("AAPL closes below its 200-day average");
    expect(r("regime_change", { to: "any" })).toBe("AAPL's Markov regime changes");
    expect(r("regime_change", { to: "Bear" })).toBe("AAPL's Markov regime turns Bear");
    expect(r("verdict_change", {})).toBe("AAPL's AI verdict changes");
    expect(r("portfolio_drawdown", { pct: 10 }, null)).toBe("Core falls 10% from its peak");
    expect(r("position_weight", { pct: 25 }, null)).toBe("A holding in Core grows past 25%");
  });

  it("builds API params from form values", () => {
    expect(defaultParams("ma_cross")).toEqual({ direction: "below", window: "200" });
    expect(toApiParams("ma_cross", { direction: "above", window: "50" })).toEqual({ direction: "above", window: 50 });
    expect(toApiParams("price_above", { price: "201.5" })).toEqual({ price: 201.5 });
    expect(toApiParams("price_above", { price: "" })).toEqual({});
    expect(toApiParams("verdict_change", { anything: 1 })).toEqual({});
  });

  it("lists only delivery problems", () => {
    expect(deliveryIssues({ inbox: "delivered", email: "sent", webhook: "skipped: the portfolio has no webhook enabled" })).toEqual([
      "Portfolio webhook: skipped: the portfolio has no webhook enabled",
    ]);
    expect(deliveryIssues(null)).toEqual([]);
  });

  it("formats relative times", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo("2026-11-04T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-04T11:45:00Z", now)).toBe("15 min ago");
    expect(timeAgo("2026-11-04T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-11-02T12:00:00Z", now)).toBe("2 d ago");
    expect(timeAgo("2026-10-01T12:00:00Z", now)).toBe("2026-10-01");
  });

  it("every numeric default passes the browser's min/step validation", () => {
    // A default off the min + n×step grid makes the browser block the form silently.
    for (const k of ALERT_KINDS) {
      for (const f of k.fields) {
        if (f.type !== "number" || f.default === undefined) continue;
        if (f.min !== undefined) expect(f.default).toBeGreaterThanOrEqual(f.min);
        if (f.step !== undefined) {
          const n = (f.default - (f.min ?? 0)) / f.step;
          expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
        }
      }
    }
  });
});

describe("compound alerts (roadmap 3.2)", () => {
  const semis = {
    op: "and",
    scope: "holdings",
    sectors: ["Semiconductors"],
    conditions: [
      { type: "regime", regime: "Bear" },
      { type: "ma", window: 200, direction: "below" },
    ],
  };

  it("describes compound rules over holdings and over one ticker", () => {
    expect(describeRule({ kind: "compound", ticker: null, params: semis, portfolio_name: "Core" })).toBe(
      "Any Semiconductors holding in Core is in a Bear Markov regime and closes below its 200-day average",
    );
    expect(describeRule({ kind: "compound", ticker: null, params: { ...semis, sectors: [] }, portfolio_name: null })).toBe(
      "Any holding in the portfolio is in a Bear Markov regime and closes below its 200-day average",
    );
    const three = {
      op: "or",
      scope: "ticker",
      sectors: [],
      conditions: [
        { type: "daily_move", pct: 5, direction: "down" },
        { type: "verdict", verdict: "sell" },
        { type: "price_below", price: 120 },
      ],
    };
    expect(describeRule({ kind: "compound", ticker: "NVDA", params: three, portfolio_name: null })).toBe(
      "NVDA falls 5% or more in a day, has a SELL AI verdict, or trades below 120",
    );
    expect(describeCondition({ type: "weight_above", pct: 20 }, "Core")).toBe("is over 20% of Core");
    expect(describeCondition({ type: "daily_move", pct: 3, direction: "any" })).toBe("moves 3% or more in a day");
    expect(describeCondition({ type: "ma", window: 50, direction: "above" })).toBe("closes above its 50-day average");
  });

  it("explains how a rule fires", () => {
    expect(firingNote({ kind: "compound", params: semis })).toMatch(/each holding/);
    expect(firingNote({ kind: "compound", params: { ...semis, scope: "ticker", sectors: [] } })).toMatch(/all of these/);
    expect(firingNote({ kind: "regime_change", params: {} })).toMatch(/Records the current value/);
    expect(firingNote({ kind: "price_above", params: { price: 1 } })).toMatch(/becomes true/);
  });

  it("knows when a portfolio is needed and when re-runs apply", () => {
    expect(needsPortfolio({ kind: "compound", params: semis })).toBe(true);
    expect(needsPortfolio({ kind: "compound", params: { scope: "ticker", conditions: [{ type: "weight_above", pct: 9 }] } })).toBe(true);
    expect(needsPortfolio({ kind: "compound", params: { scope: "ticker", conditions: [{ type: "ma" }] } })).toBe(false);
    expect(needsPortfolio({ kind: "position_weight", params: { pct: 9 } })).toBe(true);
    expect(needsPortfolio({ kind: "price_above", params: { price: 9 } })).toBe(false);
    expect(canRerun("portfolio_drawdown")).toBe(false);
    expect(canRerun("compound")).toBe(true);
  });

  it("turns an approved proposal into a create request", () => {
    expect(
      compiledToRequest({
        kind: "compound", ticker: null, portfolio_id: "p1", portfolio_name: "Core", params: semis,
        channels: ["inbox", "email"], cooldown_hours: 6, enabled: true, rerun_analysis: true,
      }),
    ).toEqual({
      kind: "compound", ticker: null, portfolio_id: "p1", params: semis, channels: ["inbox", "email"],
      cooldown_hours: 6, rerun_analysis: true,
    });
  });

  it("labels analyses and only flags re-run problems", () => {
    const a = { ticker: "NVDA", run_id: "r", source: "started" as const, verdict: null };
    expect(analysisLabel({ ...a, status: "running" })).toBe("NVDA analysis running…");
    expect(analysisLabel({ ...a, status: "completed", verdict: "sell" })).toBe("NVDA analysis: SELL");
    expect(analysisLabel({ ...a, status: "failed" })).toBe("NVDA analysis failed");
    expect(analysisLabel({ ...a, status: "deleted" })).toBe("NVDA analysis deleted");
    expect(unsupportedLabel("missing: how big a move")).toBe("Missing: how big a move");
    expect(unsupportedLabel("when the CEO tweets")).toBe("Not understood: when the CEO tweets");
    expect(deliveryIssues({ inbox: "delivered", analysis: "started 2" })).toEqual([]);
    expect(deliveryIssues({ analysis: "skipped: No LLM provider key is configured" })).toEqual([
      "Analysis re-run: skipped: No LLM provider key is configured",
    ]);
  });
});
