/** Fallback list; the picker prefers GET /fx/rates `supported`. Matches backend fx_service. */
export const SUPPORTED_CURRENCIES = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK",
  "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** ISO 4217 currencies that display without fractional digits. */
const ZERO_DECIMAL_CURRENCIES = new Set<string>(["JPY", "KRW", "ISK"]);

function fractionDigitsFor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

export function fmtMoney(n: number | null | undefined, currency: string): string {
  if (n == null) return "—";
  const normalizedCurrency = currency.trim().toUpperCase() || "USD";
  const digits = fractionDigitsFor(normalizedCurrency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${n.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })} ${normalizedCurrency}`;
  }
}

export function fmtPnl(pnl: number | null | undefined, pct: number | null | undefined, currency: string): string {
  if (pnl == null) return "—";
  const sign = pnl >= 0 ? "+" : "";
  const pctStr = pct != null ? ` (${pnl >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : "";
  return `${sign}${fmtMoney(pnl, currency)}${pctStr}`;
}

/** Resolve the currency label for prices on a ticker/run. */
export function resolveQuoteCurrency(
  priceCurrency?: string | null,
  metadataCurrency?: string | null,
  preferredCurrency = "USD",
): string {
  return priceCurrency ?? metadataCurrency ?? preferredCurrency;
}

/** Format a string price level (from reports) in the given currency. */
export function fmtPriceString(value: string | null | undefined, currency: string): string {
  if (!value) return "—";
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return value;
  return fmtMoney(n, currency);
}
