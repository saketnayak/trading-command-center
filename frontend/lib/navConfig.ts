export type NavItem = {
  href: string;
  label: string;
  prefetchPortfolio?: boolean;
};

export const RESEARCH_NAV: NavItem[] = [
  { href: "/runs/new", label: "New Run" },
  { href: "/runs", label: "History" },
  { href: "/runs/performance", label: "Performance" },
  { href: "/runs/compare", label: "Compare" },
];

export const PRIMARY_NAV: NavItem[] = [
  { href: "/portfolio", label: "Portfolio", prefetchPortfolio: true },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/market", label: "Market" },
  { href: "/settings", label: "Settings" },
];

export type MobileNavSection = {
  title?: string;
  items: NavItem[];
};

export const MOBILE_NAV_SECTIONS: MobileNavSection[] = [
  { title: "Research", items: RESEARCH_NAV },
  { title: "Workspace", items: PRIMARY_NAV.filter((item) => item.href !== "/settings") },
  { items: PRIMARY_NAV.filter((item) => item.href === "/settings") },
];

/** True when the current path belongs to the Research route group. */
export function isResearchActive(path: string): boolean {
  if (path === "/runs") return true;
  if (path === "/runs/new") return true;
  if (path === "/runs/performance") return true;
  if (path === "/runs/compare") return true;
  if (path.startsWith("/runs/")) return true;
  return false;
}

export function isNavItemActive(path: string, href: string): boolean {
  if (href === "/runs") {
    return (
      path === "/runs" ||
      (path.startsWith("/runs/") &&
        path !== "/runs/new" &&
        path !== "/runs/performance" &&
        path !== "/runs/compare")
    );
  }
  if (href === "/portfolio") {
    return path === "/portfolio" || path.startsWith("/portfolio/");
  }
  if (href === "/market") {
    return path === "/market" || path.startsWith("/market/");
  }
  return path === href || path.startsWith(`${href}/`);
}
