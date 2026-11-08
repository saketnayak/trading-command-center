/** Display-currency helpers: request paths, picker ordering and the "1 USD = … AUD · live" line. */

import type { PortfolioHolding } from "./types";

export type FxSource = "live" | "ecb" | "stale" | null;

/** The rates behind a response's display figures: rates_used maps a source currency to its multiplier into the display currency. */
export type FxMeta = { source: FxSource; as_of: string | null; rates_used: Record<string, number> };

export type FxRates = { base: string; rates: Record<string, number>; source: FxSource; as_of: string | null; supported: string[] };

export function withCurrency(path: string, currency?: string | null): string {
  if (!currency) return path;
  return `${path}${path.includes("?") ? "&" : "?"}currency=${encodeURIComponent(currency)}`;
}

/** The picker's two groups: currencies held in this portfolio (in supported order), then the rest. */
export function orderCurrencies(supported: readonly string[], held: readonly string[]): { held: string[]; others: string[] } {
  const heldSet = new Set(held.map((c) => c.toUpperCase()));
  return {
    held: supported.filter((c) => heldSet.has(c)),
    others: supported.filter((c) => !heldSet.has(c)),
  };
}

/** Four decimals for ordinary rates; four significant digits below 1 so tiny rates never read 0.0000. */
export function formatRate(rate: number): string {
  if (Math.abs(rate) >= 1) return rate.toFixed(4);
  return Number(rate.toPrecision(4)).toString();
}

function age(asOf: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - asOf.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function rateLine(
  fx: FxMeta | null | undefined,
  display: string,
  now: Date,
  primary?: string | null,
): { text: string; tone: "muted" | "amber"; pairs: string[] } | null {
  if (!fx) return null;
  const codes = Object.keys(fx.rates_used ?? {}).sort();
  if (codes.length === 0) return null;
  const pair = (code: string) => `1 ${code} = ${formatRate(fx.rates_used[code])} ${display}`;
  const main = primary && fx.rates_used[primary] != null ? primary : codes[0];
  const asOf = fx.as_of ? new Date(fx.as_of) : null;
  let label: string;
  if (fx.source === "ecb") {
    label = asOf ? `ECB daily · ${asOf.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "ECB daily";
  } else if (fx.source === "stale") {
    label = asOf ? `stale · ${age(asOf, now)}` : "stale";
  } else {
    label = asOf ? `live · ${age(asOf, now)}` : "live";
  }
  return { text: `${pair(main)} · ${label}`, tone: fx.source === "stale" ? "amber" : "muted", pairs: codes.map(pair) };
}

type MoneyField = "current_price" | "market_value" | "unrealized_pnl";

/** A holdings cell: the display-currency figure, plus the native one as subtext when it trades in another currency.
 * With showNative, the native figure alone (today's per-row behaviour). */
export function rowMoney(
  h: PortfolioHolding,
  field: MoneyField,
  showNative: boolean,
  display: string,
): { value: number | null; currency: string; native: { value: number; currency: string } | null } {
  const quote = h.quote_currency ?? display;
  const nativeValue = h[field] ?? null;
  if (showNative) return { value: nativeValue, currency: quote, native: null };
  const value = h[`${field}_display`] ?? null;
  // P&L has no meaningful native subtext when it was only computable in the display currency.
  const showSub = quote !== display && nativeValue != null && value != null && field !== "unrealized_pnl";
  return { value, currency: display, native: showSub ? { value: nativeValue, currency: quote } : null };
}

export function sortValue(
  h: PortfolioHolding,
  key: MoneyField | "unrealized_pnl_pct",
  showNative: boolean,
): number | null {
  return (showNative ? h[key] : h[`${key}_display`]) ?? null;
}
