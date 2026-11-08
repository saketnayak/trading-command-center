/** Net worth (GET /net-worth): types and pure helpers. */

import type { FxMeta } from "./displayCurrency";
import { fmtMoney } from "./currency";

export type NetWorthRange = "6m" | "ytd" | "1y" | "3y" | "5y";
export const NET_WORTH_RANGES: { id: NetWorthRange; label: string }[] = [
  { id: "6m", label: "6M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1Y" },
  { id: "3y", label: "3Y" },
  { id: "5y", label: "5Y" },
];

export interface NetWorthItem {
  id: string;
  kind: "asset" | "liability";
  category: string;
  category_label: string;
  name: string;
  currency: string;
  notes: string | null;
  value: number | null;
  balance: number | null;
  as_of: string | null;
  first_date: string | null;
  value_display: number | null;
  wallet_chain: "btc" | "eth" | null;
  wallet_address: string | null;
  synced_at: string | null;
  sync_error: string | null;
  valuations: { date: string; value: number }[];
  stale: boolean;
}

export interface CategoryRow {
  category: string;
  label: string;
  value: number;
  share: number | null;
}

export interface NetWorthPoint {
  date: string;
  investments: number;
  other_assets: number;
  liabilities: number;
  net_worth: number;
}

export interface NetWorthReport {
  display_currency: string;
  range: NetWorthRange;
  start: string;
  end: string;
  assets: number;
  liabilities: number;
  net_worth: number;
  investments: number;
  debt_ratio: number | null;
  assets_by_category: CategoryRow[];
  liabilities_by_category: CategoryRow[];
  change: { since: string; amount: number; pct: number | null } | null;
  portfolios: { id: string; name: string; value: number; mode: string | null; start: string | null; holdings_source: string | null }[];
  items: NetWorthItem[];
  series: NetWorthPoint[];
  categories: { asset: { id: string; label: string }[]; liability: { id: string; label: string }[] };
  warnings: string[];
  methodology: string;
  /** Items left out for want of an exchange rate to the display currency. */
  excluded?: { id: string; name: string; currency: string }[];
  fx?: FxMeta | null;
}

export interface NetWorthItemInput {
  kind: "asset" | "liability";
  category: string;
  name: string;
  currency?: string;
  value?: number;
  as_of?: string;
  notes?: string | null;
  wallet_chain?: "btc" | "eth";
  wallet_address?: string;
}

export const ITEM_CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "CHF", "JPY", "CNY", "INR", "SGD"];

/** "+$12,300.00 (+4.1%) since 2025-11-05", or null without a starting point. */
export function changeText(r: NetWorthReport): string | null {
  const c = r.change;
  if (!c) return null;
  const sign = c.amount > 0 ? "+" : c.amount < 0 ? "−" : "";
  const pct = c.pct == null ? "" : ` (${sign}${Math.abs(c.pct * 100).toFixed(1)}%)`;
  return `${sign}${fmtMoney(Math.abs(c.amount), r.display_currency)}${pct} since ${c.since}`;
}

/** A wallet's balance with its coin, e.g. "0.5 BTC". */
export function walletBalance(item: NetWorthItem): string | null {
  if (!item.wallet_chain || item.balance == null) return null;
  return `${item.balance.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${item.wallet_chain.toUpperCase()}`;
}

/** "bc1qxy…0wlh": enough of an address to recognise it. */
export function shortAddress(address: string | null): string {
  if (!address) return "";
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Validate the add form before sending; returns a message or null. */
export function itemProblem(input: NetWorthItemInput & { valueText?: string }): string | null {
  if (!input.name.trim()) return "Give it a name.";
  if (input.wallet_chain) {
    const a = (input.wallet_address ?? "").trim();
    if (input.wallet_chain === "eth" && !/^0x[0-9a-fA-F]{40}$/.test(a)) return "An ETH address is 0x followed by 40 hex characters.";
    if (input.wallet_chain === "btc" && !/^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a)) return "That doesn't look like a BTC address.";
    return null;
  }
  const v = Number(input.valueText ?? input.value);
  if ((input.valueText ?? "").trim() === "" || !Number.isFinite(v) || v < 0) return "Enter the current value (0 or more).";
  return null;
}

/** Items whose first value falls inside the chart, so the line steps up (or down) when they start. */
export function itemsStartingInRange(r: NetWorthReport): string | null {
  const late = r.items.filter((i) => i.first_date && i.first_date > r.start)
    .sort((a, b) => (a.first_date! < b.first_date! ? -1 : 1));
  if (!late.length) return null;
  return `Steps where an item starts counting: ${late.map((i) => `${i.name} (${i.first_date})`).join(", ")}. `
    + "Record an earlier value in its History to fill in the line.";
}
