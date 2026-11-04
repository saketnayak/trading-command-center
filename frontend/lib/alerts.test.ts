import { describe, expect, it } from "vitest";
import { ALERT_KINDS, defaultParams, deliveryIssues, describeRule, timeAgo, toApiParams } from "./alerts";

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
