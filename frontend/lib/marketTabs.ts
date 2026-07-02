export type MarketTab = "trending" | "discover";

export const DEFAULT_MARKET_TAB: MarketTab = "trending";

const VALID_MARKET_TABS: readonly MarketTab[] = ["trending", "discover"];

export interface MarketTabDefinition {
  id: MarketTab;
  label: string;
  badge?: string;
}

export const MARKET_TAB_DEFINITIONS: MarketTabDefinition[] = [
  { id: "trending", label: "Trending", badge: "↑" },
  { id: "discover", label: "Discover", badge: "🔍" },
];

export function isMarketTab(value: string | null | undefined): value is MarketTab {
  return value != null && (VALID_MARKET_TABS as readonly string[]).includes(value);
}

export function resolveMarketTab(value: string | null | undefined): MarketTab {
  return isMarketTab(value) ? value : DEFAULT_MARKET_TAB;
}
