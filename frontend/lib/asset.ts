const CRYPTO_QUOTE_CURRENCIES = new Set(["USD", "USDT", "USDC", "BTC", "ETH", "EUR"]);

/** True for crypto tickers like BTC-USD, ETH-USDC. Requires a recognised quote currency
 *  suffix to avoid false-positives on hyphenated equities (BRK-B, BF-B). */
export function isCrypto(ticker: string): boolean {
  const parts = ticker.split("-");
  return parts.length >= 2 && CRYPTO_QUOTE_CURRENCIES.has(parts[parts.length - 1].toUpperCase());
}

/** "BTC" for BTC-USD; the ticker itself for anything else. */
export function cryptoBase(ticker: string): string {
  return isCrypto(ticker) ? ticker.split("-").slice(0, -1).join("-").toUpperCase() : ticker;
}

/** What a position's quantity is counted in: coins for crypto ("BTC"), shares otherwise ("sh"). */
export function quantityUnit(ticker: string): string {
  return isCrypto(ticker) ? cryptoBase(ticker) : "sh";
}

/** A count of coins in short form: 20.11M BTC, 120.5K ETH. */
export function fmtCoinCount(n: number | null | undefined, unit: string): string | null {
  if (n == null) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B ${unit}`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M ${unit}`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K ${unit}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`;
}
