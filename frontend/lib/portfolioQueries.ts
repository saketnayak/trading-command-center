export const PORTFOLIO_NEWS_DAYS = 7;
export const PORTFOLIO_EARNINGS_DAYS_AHEAD = 60;

export const portfolioQueryKeys = {
  list: ["portfolios"] as const,
  current: (id: string) => ["portfolio-current", id] as const,
  fundamentals: (id: string) => ["portfolio-fundamentals", id] as const,
  regime: (id: string) => ["portfolio-regime", id] as const,
  wave: (id: string) => ["portfolio-wave", id] as const,
  trimSignals: (id: string) => ["portfolio-trim-signals", id] as const,
  earnings: (id: string) => ["portfolio-earnings", id] as const,
  news: (id: string) => ["portfolio-news", id] as const,
  behavioralAlerts: (id: string) => ["behavioralAlerts", id] as const,
  insightLatest: (id: string) => ["insight-latest", id] as const,
  insightsList: (id: string) => ["insights-list", id] as const,
};

export const marketQueryKeys = {
  trending: ["market-trending"] as const,
  movers: ["market-movers"] as const,
  sectors: ["market-sectors"] as const,
};

export const PORTFOLIO_STALE_TIMES = {
  current: 60_000,
  fundamentals: 30 * 60_000,
  regime: 4 * 60 * 60_000,
  wave: 4 * 60 * 60_000,
  trimSignals: 30 * 60_000,
  earnings: 30 * 60_000,
  news: 15 * 60_000,
  behavioralAlerts: 5 * 60_000,
} as const;

export const MARKET_STALE_TIMES = {
  trending: 30 * 60_000,
  movers: 30 * 60_000,
  sectors: 30 * 60_000,
} as const;

export function allMarketQueryKeys(): readonly (readonly string[])[] {
  return [marketQueryKeys.trending, marketQueryKeys.movers, marketQueryKeys.sectors];
}

function appendPortfolioTabCacheKeys(
  keys: (readonly string[])[],
  portfolioId: string,
  options: PortfolioPrefetchOptions = {}
): void {
  keys.push(portfolioQueryKeys.news(portfolioId));
  if (options.includeEarnings !== false) {
    keys.push(portfolioQueryKeys.earnings(portfolioId));
  }
  keys.push(...allMarketQueryKeys());
}

export type PortfolioTab =
  | "holdings"
  | "insights"
  | "earnings"
  | "news"
  | "trending"
  | "discover"
  | "chat"
  | "thesis";

export interface PortfolioSyncContext {
  portfolioId: string;
  activeTab: PortfolioTab;
  markovEnabled: boolean;
  waveEnabled: boolean;
}

export function buildPortfolioSyncQueryKeys(
  ctx: PortfolioSyncContext
): readonly (readonly string[])[] {
  const { portfolioId, activeTab, markovEnabled, waveEnabled } = ctx;
  const keys: (readonly string[])[] = [
    portfolioQueryKeys.list,
    portfolioQueryKeys.current(portfolioId),
    portfolioQueryKeys.fundamentals(portfolioId),
    portfolioQueryKeys.behavioralAlerts(portfolioId),
  ];

  if (markovEnabled) {
    keys.push(portfolioQueryKeys.regime(portfolioId));
    keys.push(portfolioQueryKeys.trimSignals(portfolioId));
  }
  if (waveEnabled) {
    keys.push(portfolioQueryKeys.wave(portfolioId));
  }
  appendPortfolioTabCacheKeys(keys, portfolioId);
  if (activeTab === "insights") {
    keys.push(portfolioQueryKeys.insightLatest(portfolioId));
    keys.push(portfolioQueryKeys.insightsList(portfolioId));
  }

  return keys;
}

export interface PortfolioPrefetchOptions {
  markovEnabled?: boolean;
  waveEnabled?: boolean;
  includeEarnings?: boolean;
}

/** Query keys warmed on nav-intent prefetch (excludes app-settings). */
export function buildPortfolioPrefetchQueryKeys(
  portfolioId: string,
  options: PortfolioPrefetchOptions = {}
): readonly (readonly string[])[] {
  const { markovEnabled = true, waveEnabled = true } = options;
  const keys: (readonly string[])[] = [
    portfolioQueryKeys.list,
    portfolioQueryKeys.current(portfolioId),
    portfolioQueryKeys.fundamentals(portfolioId),
    portfolioQueryKeys.behavioralAlerts(portfolioId),
  ];

  if (markovEnabled) {
    keys.push(portfolioQueryKeys.regime(portfolioId));
    keys.push(portfolioQueryKeys.trimSignals(portfolioId));
  }
  if (waveEnabled) {
    keys.push(portfolioQueryKeys.wave(portfolioId));
  }

  appendPortfolioTabCacheKeys(keys, portfolioId, options);

  return keys;
}
