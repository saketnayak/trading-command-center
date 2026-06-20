const STORAGE_KEY = "agentfloor:last-portfolio-id";

export function getLastPortfolioId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastPortfolioId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // private mode or storage full — ignore
  }
}

export function resolvePortfolioId(
  portfolios: readonly { id: string }[],
  preferredId: string | null
): string | null {
  if (portfolios.length === 0) return null;
  if (preferredId && portfolios.some((p) => p.id === preferredId)) {
    return preferredId;
  }
  return portfolios[0]?.id ?? null;
}
