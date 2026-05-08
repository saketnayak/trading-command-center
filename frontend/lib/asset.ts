const CRYPTO_QUOTE_CURRENCIES = new Set(["USD", "USDT", "USDC", "BTC", "ETH", "EUR"]);

/** True for crypto tickers like BTC-USD, ETH-USDC. Requires a recognised quote currency
 *  suffix to avoid false-positives on hyphenated equities (BRK-B, BF-B). */
export function isCrypto(ticker: string): boolean {
  const parts = ticker.split("-");
  return parts.length >= 2 && CRYPTO_QUOTE_CURRENCIES.has(parts[parts.length - 1].toUpperCase());
}
