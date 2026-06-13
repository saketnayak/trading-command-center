import type { FinnhubUnavailableReason } from "./types";

const FEATURE_LABELS: Record<string, string> = {
  news: "company news",
  earnings: "earnings calendar",
  fundamentals: "fundamentals",
};

export function finnhubUnavailableMessage(
  reason: FinnhubUnavailableReason | null | undefined,
  feature: keyof typeof FEATURE_LABELS,
): string | null {
  if (!reason) return null;
  const label = FEATURE_LABELS[feature] ?? feature;
  switch (reason) {
    case "no_finnhub_key":
      return `Could not load ${label}. Add a Finnhub API key in Settings.`;
    case "invalid_key":
      return `Could not load ${label}. Your Finnhub API key is invalid — update it in Settings.`;
    case "premium_required":
      return `Your Finnhub plan does not include ${label}. Upgrade to Premium Access on Finnhub.`;
    case "access_denied":
      return `Your Finnhub API key cannot access ${label}.`;
    case "rate_limited":
      return `Finnhub rate limit reached while loading ${label}. Try again shortly.`;
    case "provider_unavailable":
      return `Finnhub is temporarily unavailable for ${label}.`;
    default:
      return `Could not load ${label} from Finnhub.`;
  }
}

export const FINNHUB_CAPABILITY_LABELS: Record<string, string> = {
  quote: "Live quotes",
  stock_candle: "Historical candles",
  stock_metric: "Fundamentals",
  company_news: "Company news",
  earnings_calendar: "Earnings calendar",
  stock_profile: "Company profiles",
  crypto_candle: "Crypto candles",
};
