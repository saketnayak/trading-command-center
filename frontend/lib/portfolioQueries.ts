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
  if (activeTab === "earnings") {
    keys.push(portfolioQueryKeys.earnings(portfolioId));
  }
  if (activeTab === "news") {
    keys.push(portfolioQueryKeys.news(portfolioId));
  }
  if (activeTab === "insights") {
    keys.push(portfolioQueryKeys.insightLatest(portfolioId));
    keys.push(portfolioQueryKeys.insightsList(portfolioId));
  }

  return keys;
}

export interface PortfolioPrefetchOptions {
  markovEnabled?: boolean;
  waveEnabled?: boolean;
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

  return keys;
}
