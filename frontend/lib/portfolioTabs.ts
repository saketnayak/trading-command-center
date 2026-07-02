import type { PortfolioTab } from "@/lib/portfolioQueries";

export type { PortfolioTab };

export const DEFAULT_PORTFOLIO_TAB: PortfolioTab = "holdings";

export const PRIMARY_PORTFOLIO_TAB_IDS: readonly PortfolioTab[] = ["holdings", "insights", "earnings", "news"];

const VALID_TABS: readonly PortfolioTab[] = [
  "holdings",
  "insights",
  "earnings",
  "news",
  "chat",
  "thesis",
];

export interface PortfolioTabDefinition {
  id: PortfolioTab;
  label: string;
  /** Shown below `sm` when the full label would crowd the tab bar. */
  shortLabel?: string;
  tier: "primary" | "overflow";
  badge?: string;
  /** Shown on tab when behavioral alerts exist (Insights only). */
  showAlertCount?: boolean;
  hideWhenAllCrypto?: boolean;
}

const BASE_TAB_DEFINITIONS: PortfolioTabDefinition[] = [
  { id: "holdings", label: "Holdings", tier: "primary" },
  { id: "insights", label: "AI Insights", shortLabel: "Insights", tier: "primary", badge: "✦", showAlertCount: true },
  { id: "earnings", label: "Earnings", shortLabel: "Earn.", tier: "primary", hideWhenAllCrypto: true },
  { id: "news", label: "News", tier: "primary" },
  { id: "chat", label: "Chat", tier: "overflow" },
  { id: "thesis", label: "Thesis", tier: "overflow" },
];

export interface PortfolioTabGroups {
  primary: PortfolioTabDefinition[];
  overflow: PortfolioTabDefinition[];
  all: PortfolioTabDefinition[];
}

export function isPortfolioTab(value: string | null | undefined): value is PortfolioTab {
  return value != null && (VALID_TABS as readonly string[]).includes(value);
}

export function resolvePortfolioTab(
  value: string | null | undefined,
  options: { allCrypto: boolean } = { allCrypto: false },
): PortfolioTab {
  const groups = buildPortfolioTabGroups(options);
  const allowed = new Set(groups.all.map((t) => t.id));
  if (value && allowed.has(value as PortfolioTab)) {
    return value as PortfolioTab;
  }
  return DEFAULT_PORTFOLIO_TAB;
}

export function buildPortfolioTabGroups(options: { allCrypto: boolean }): PortfolioTabGroups {
  const visible = BASE_TAB_DEFINITIONS.filter(
    (tab) => !(tab.hideWhenAllCrypto && options.allCrypto),
  );
  return {
    primary: visible.filter((tab) => tab.tier === "primary"),
    overflow: visible.filter((tab) => tab.tier === "overflow"),
    all: visible,
  };
}

export function isOverflowPortfolioTab(
  tab: PortfolioTab,
  options: { allCrypto: boolean },
): boolean {
  return buildPortfolioTabGroups(options).overflow.some((t) => t.id === tab);
}

/** Legacy portfolio tab query values moved to /market in Phase 1B. */
export function legacyPortfolioTabRedirect(tab: string | null): string | null {
  if (tab === "trending") return "/market";
  if (tab === "discover") return "/market?tab=discover";
  return null;
}
