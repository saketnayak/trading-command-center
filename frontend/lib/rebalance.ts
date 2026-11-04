/** Target allocation & rebalancing (/portfolio/{id}/targets, /rebalance): types and pure helpers. */

export type RebalanceMode = "bands" | "full" | "contribute" | "withdraw";

export const REBALANCE_MODES: { id: RebalanceMode; label: string; hint: string; needsAmount: boolean }[] = [
  { id: "bands", label: "Only what's off target", hint: "Trades only holdings outside their tolerance band.", needsAmount: false },
  { id: "full", label: "Full rebalance", hint: "Brings every holding back to its exact target.", needsAmount: false },
  { id: "contribute", label: "Invest new cash", hint: "Buys only: new money goes to underweight holdings, in proportion to how far each is below target; any excess follows the targets.", needsAmount: true },
  { id: "withdraw", label: "Raise cash", hint: "Sells only: takes from overweight holdings, in proportion to how far each is above target; any remainder comes pro rata.", needsAmount: true },
];

export interface TargetRow {
  ticker: string;
  weight: number; // 0..1
  band: number; // 0..0.5 absolute
}

export interface DriftRow {
  ticker: string;
  shares: number;
  price: number | null;
  value: number | null;
  weight: number | null;
  target: number | null;
  band: number | null;
  drift: number | null;
  status: "over" | "under" | "ok" | "untargeted" | "not_held";
}

export interface PlanTrade {
  ticker: string;
  action: "buy" | "sell";
  amount: number;
  shares: number;
  price: number;
  weight_before: number;
  weight_after: number;
}

export interface RebalancePlan {
  mode: RebalanceMode;
  trades: PlanTrade[];
  summary: {
    trades: number;
    buys: number;
    sells: number;
    cash_in: number;
    cash_out: number;
    cash_left: number;
    turnover: number | null;
    max_drift_before: number;
    max_drift_after: number;
  };
  weights_after: Record<string, number>;
}

export interface RebalanceResponse {
  portfolio_id: string;
  display_currency: string;
  disclaimer: string;
  targets: TargetRow[];
  warnings: string[];
  drift: DriftRow[];
  plan: RebalancePlan | null;
  total_value: number;
  message: string | null;
}

/** Editable target row: weight as a percent string so the input can be blank mid-edit. */
export interface TargetDraft {
  ticker: string;
  pct: string;
}

export function draftsFromTargets(targets: TargetRow[]): TargetDraft[] {
  return targets.map((t) => ({ ticker: t.ticker, pct: trimPct(t.weight * 100) }));
}

function trimPct(x: number): string {
  return String(Math.round(x * 100) / 100);
}

/** Seed targets from today's weights (what you hold now becomes the target). */
export function draftsFromCurrent(drift: DriftRow[]): TargetDraft[] {
  const held = drift.filter((r) => (r.weight ?? 0) > 0);
  return normaliseDrafts(held.map((r) => ({ ticker: r.ticker, pct: trimPct((r.weight ?? 0) * 100) })));
}

/** Equal weight across the given tickers. */
export function equalWeightDrafts(tickers: string[]): TargetDraft[] {
  if (tickers.length === 0) return [];
  return normaliseDrafts(tickers.map((t) => ({ ticker: t, pct: String(100 / tickers.length) })));
}

export function draftSum(drafts: TargetDraft[]): number {
  return drafts.reduce((s, d) => s + (Number(d.pct) || 0), 0);
}

/** Scale to exactly 100% (two decimals), putting the rounding remainder on the largest row. */
export function normaliseDrafts(drafts: TargetDraft[]): TargetDraft[] {
  const sum = draftSum(drafts);
  if (sum <= 0) return drafts;
  const scaled = drafts.map((d) => ({ ...d, pct: Math.round(((Number(d.pct) || 0) / sum) * 10000) / 100 }));
  const rem = Math.round((100 - scaled.reduce((s, d) => s + d.pct, 0)) * 100) / 100;
  if (rem !== 0 && scaled.length) {
    const i = scaled.reduce((best, d, j) => (d.pct > scaled[best].pct ? j : best), 0);
    scaled[i].pct = Math.round((scaled[i].pct + rem) * 100) / 100;
  }
  return scaled.map((d) => ({ ...d, pct: String(d.pct) }));
}

/** Drafts → API rows (fractions), dropping blank tickers. */
export function draftsToTargets(drafts: TargetDraft[], band: number): TargetRow[] {
  return drafts
    .filter((d) => d.ticker.trim())
    // Percent with up to 2 decimals → fraction with up to 4, without float noise (21.74 → 0.2174).
    .map((d) => ({ ticker: d.ticker.trim().toUpperCase(), weight: Math.round((Number(d.pct) || 0) * 100) / 10000, band }));
}

/** First problem with the drafts, or null when they can be saved. */
export function draftProblem(drafts: TargetDraft[]): string | null {
  const named = drafts.filter((d) => d.ticker.trim());
  const seen = new Set<string>();
  for (const d of named) {
    const t = d.ticker.trim().toUpperCase();
    if (seen.has(t)) return `${t} appears twice.`;
    seen.add(t);
    const n = Number(d.pct);
    if (d.pct.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) return `Enter a percentage for ${t}.`;
  }
  const sum = draftSum(named);
  if (named.length && Math.abs(sum - 100) > 0.1) return `Targets add up to ${sum.toFixed(2)}%, not 100%.`;
  return null;
}

/** The plan as CSV (ticker, action, shares, price, amount, weights). */
export function planCsv(plan: RebalancePlan, currency: string): string {
  const head = ["ticker", "action", "shares", "price", `amount_${currency}`, "weight_before", "weight_after"];
  const lines = plan.trades.map((t) =>
    [t.ticker, t.action, t.shares, t.price, t.amount, t.weight_before, t.weight_after].join(","),
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}
