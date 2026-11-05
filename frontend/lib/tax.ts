/** Tax tools (GET /portfolio/{id}/tax): types and pure helpers. Informational only. */

import { fmtMoney } from "./currency";

export interface WashReplacement {
  date: string;
  account: string;
  portfolio: string;
  quantity: number;
}

export interface TaxRow {
  date_sold: string;
  date_acquired: string;
  symbol: string;
  account: string;
  currency: string;
  quantity: number;
  proceeds: number;
  cost: number;
  gain: number;
  term: "short" | "long";
  code: "" | "W";
  adjustment: number;
  adjusted_gain: number;
  replacements: WashReplacement[];
}

export interface TermTotals {
  proceeds: number;
  cost: number;
  gain: number;
  adjustment: number;
  adjusted_gain: number;
}

export interface TaxTotals {
  currency: string;
  short: TermTotals;
  long: TermTotals;
  net: number;
}

export interface HarvestCandidate {
  symbol: string;
  account: string;
  open_date: string;
  quantity: number;
  cost_per_share: number;
  price: number;
  loss_local: number;
  loss: number;
  loss_pct: number | null;
  term: "short" | "long";
  days_to_long_term: number;
  recent_buys: WashReplacement[];
  avoid_buying_until: string;
}

export interface TaxReport {
  portfolio_id: string;
  display_currency: string;
  disclaimer: string;
  jurisdiction: string;
  cost_basis_method: string;
  available: boolean;
  year: number;
  years: number[];
  report: { year: number; rows: TaxRow[]; totals: TaxTotals[] } | null;
  wash_sales: TaxRow[];
  harvest: HarvestCandidate[];
  min_loss?: number;
  warnings: string[];
  message: string | null;
}

export interface ReplacementIdeas {
  symbol: string;
  ideas: { symbol: string; name: string; correlation: number; strength: "close" | "moderate" | "loose"; days: number }[];
  message: string | null;
  note: string;
}

/** Form 8949-style CSV of a tax year's sales (one row per lot sold). */
export function taxRowsCsv(rows: TaxRow[]): string {
  const head = ["description", "date_acquired", "date_sold", "proceeds", "cost_basis", "adjustment_code",
    "adjustment", "gain_or_loss", "term", "account", "currency"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map((r) =>
    [esc(`${r.quantity} ${r.symbol}`), r.date_acquired, r.date_sold, r.proceeds.toFixed(2), r.cost.toFixed(2), r.code,
      r.adjustment.toFixed(2), r.adjusted_gain.toFixed(2), r.term, esc(r.account), r.currency].join(","),
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}

/** One-line summary of a year's realised result, or null when nothing was sold. */
export function taxHeadline(r: TaxReport): string | null {
  const totals = r.report?.totals ?? [];
  if (!totals.length) return null;
  const parts = totals.map((t) => {
    const net = t.net;
    const word = net >= 0 ? "net gain" : "net loss";
    return `${fmtMoney(Math.abs(net), t.currency)} ${word}`;
  });
  const washed = totals.reduce((s, t) => s + t.short.adjustment + t.long.adjustment, 0);
  const wash = washed > 0 ? `, after ${r.wash_sales.length} wash sale${r.wash_sales.length === 1 ? "" : "s"}` : "";
  return `${r.year}: ${parts.join(" + ")} realised${wash}.`;
}

/** Plain words for a harvest candidate's wash-sale risk. */
export function washRiskText(c: HarvestCandidate): string | null {
  if (!c.recent_buys.length) return null;
  const b = [...c.recent_buys].sort((x, y) => x.date.localeCompare(y.date))[c.recent_buys.length - 1];
  const where = b.portfolio ? `${b.portfolio} / ${b.account}` : b.account;
  return `Bought ${b.quantity} on ${b.date} (${where}): selling at a loss now would be a wash sale.`;
}
