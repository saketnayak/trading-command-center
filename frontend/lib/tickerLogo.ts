/** Authenticated logo proxy path served by the Next.js route handler. */
export function tickerLogoSrc(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return "";
  return `/tickers/${encodeURIComponent(normalized)}/logo`;
}
