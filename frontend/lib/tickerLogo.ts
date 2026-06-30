/** Authenticated logo proxy path served by the Next.js API route. */
export function tickerLogoSrc(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return "";
  return `/api/tickers/${encodeURIComponent(normalized)}/logo`;
}
