import { getSession } from "next-auth/react";
import type { Run, AgentEventPayload, CreateRunRequest, ApiKeyStatus, User, Report, RunStats, CompareResult, RunOutcome, PerformanceStats, Watchlist, WatchlistItem, AddWatchlistItemRequest, Portfolio, PortfolioSnapshot, PortfolioCurrentResponse, PortfolioInsight, GenerateInsightRequest, EarningsEvent, FundamentalsData, NewsArticle, BatchRunResult, TickerSnapshot, MarketTicker, MoversResponse, SectorData } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function fetchWithAuth(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await getSession();
  const token = (session as { accessToken?: string })?.accessToken;
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export async function getRuns(params?: { ticker?: string; status?: string; verdict?: string; archived?: boolean; limit?: number; offset?: number }): Promise<Run[]> {
  const p: Record<string, string> = {};
  if (params?.ticker) p.ticker = params.ticker;
  if (params?.status) p.status = params.status;
  if (params?.verdict) p.verdict = params.verdict;
  if (params?.archived) p.archived = "true";
  if (params?.limit != null) p.limit = String(params.limit);
  if (params?.offset != null) p.offset = String(params.offset);
  const qs = new URLSearchParams(p).toString();
  const r = await fetchWithAuth(`/runs${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error("Failed to fetch runs");
  return r.json();
}

export async function getRun(id: string): Promise<Run> {
  const r = await fetchWithAuth(`/runs/${id}`);
  if (!r.ok) throw new Error("Run not found");
  return r.json();
}

export async function createRun(req: CreateRunRequest): Promise<Run> {
  const r = await fetchWithAuth("/runs", { method: "POST", body: JSON.stringify(req) });
  if (!r.ok) throw new Error("Failed to create run");
  return r.json();
}

export async function abortRun(id: string): Promise<void> {
  await fetchWithAuth(`/runs/${id}`, { method: "DELETE" });
}

export async function updateRun(id: string, data: { label?: string | null }): Promise<Run> {
  const r = await fetchWithAuth(`/runs/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  if (!r.ok) throw new Error("Failed to update run");
  return r.json();
}

export async function archiveRun(id: string): Promise<Run> {
  const r = await fetchWithAuth(`/runs/${id}/archive`, { method: "POST" });
  if (!r.ok) throw new Error("Failed to archive run");
  return r.json();
}

export async function deleteRun(id: string): Promise<void> {
  const r = await fetchWithAuth(`/runs/${id}/delete`, { method: "DELETE" });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Failed to delete run");
  }
}

export async function bulkAbortRuns(ids: string[]): Promise<{ aborted: string[] }> {
  const r = await fetchWithAuth("/runs/bulk-abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_ids: ids }),
  });
  if (!r.ok) throw new Error("Failed to abort runs");
  return r.json();
}

export async function bulkDeleteRuns(ids: string[]): Promise<{ deleted: string[]; skipped_running: string[] }> {
  const r = await fetchWithAuth("/runs/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_ids: ids }),
  });
  if (!r.ok) throw new Error("Failed to delete runs");
  return r.json();
}

export async function getReport(runId: string): Promise<Report> {
  const r = await fetchWithAuth(`/runs/${runId}/report`);
  if (!r.ok) throw new Error("Report not found");
  return r.json();
}

export async function getRunEvents(id: string): Promise<AgentEventPayload[]> {
  const r = await fetchWithAuth(`/runs/${id}/events`);
  if (!r.ok) throw new Error("Failed to fetch events");
  return r.json();
}

export async function getApiKeys(): Promise<ApiKeyStatus[]> {
  const r = await fetchWithAuth("/api-keys");
  if (!r.ok) throw new Error("Failed to fetch API keys");
  return r.json();
}

export async function upsertApiKey(provider: string, key: string): Promise<ApiKeyStatus> {
  const r = await fetchWithAuth("/api-keys", { method: "POST", body: JSON.stringify({ provider, key }) });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const detail = body?.detail ?? `HTTP ${r.status}`;
    if (r.status === 401) throw new Error(`Session expired — please sign out and back in (${detail})`);
    if (r.status === 403) throw new Error(`Admin access required`);
    throw new Error(`Failed to save: ${detail}`);
  }
  return r.json();
}

export async function deleteApiKey(provider: string): Promise<void> {
  await fetchWithAuth(`/api-keys/${provider}`, { method: "DELETE" });
}

export async function getUsers(): Promise<User[]> {
  const r = await fetchWithAuth("/users");
  if (!r.ok) throw new Error("Failed to fetch users");
  return r.json();
}

export async function inviteUser(email: string): Promise<{ message: string; invite_url: string | null }> {
  const r = await fetchWithAuth("/auth/invite", { method: "POST", body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error("Failed to send invite");
  return r.json();
}

export async function updateUserRole(id: string, role: string): Promise<User> {
  const r = await fetchWithAuth(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
  if (!r.ok) throw new Error("Failed to update user");
  return r.json();
}

export async function deleteUser(id: string): Promise<void> {
  await fetchWithAuth(`/users/${id}`, { method: "DELETE" });
}

export async function getProviderModels(provider: string): Promise<string[]> {
  const r = await fetchWithAuth(`/llm-providers/${provider}/models`);
  if (!r.ok) throw new Error(`Could not fetch models for ${provider}`);
  return r.json();
}

export async function getRunStats(): Promise<RunStats> {
  const r = await fetchWithAuth("/runs/stats");
  if (!r.ok) throw new Error("Failed to fetch stats");
  return r.json();
}

export async function getSmtpStatus(): Promise<{ configured: boolean; from_address: string | null }> {
  const r = await fetchWithAuth("/auth/smtp-status");
  if (!r.ok) throw new Error("Failed to fetch SMTP status");
  return r.json();
}

export async function getTickerSnapshot(ticker: string): Promise<TickerSnapshot> {
  const r = await fetchWithAuth(`/ticker/${encodeURIComponent(ticker)}/snapshot`);
  if (!r.ok) throw new Error("Failed to fetch ticker snapshot");
  return r.json();
}

export async function getMe(): Promise<User> {
  const r = await fetchWithAuth("/auth/me");
  if (!r.ok) throw new Error("Failed to fetch profile");
  return r.json();
}

export async function updateProfile(data: { name?: string; current_password?: string; new_password?: string; preferred_currency?: string }): Promise<void> {
  const r = await fetchWithAuth("/auth/me", { method: "PATCH", body: JSON.stringify(data) });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Failed to update profile");
  }
}

export async function compareRuns(a: string, b: string): Promise<CompareResult> {
  const r = await fetchWithAuth(`/runs/compare?a=${a}&b=${b}`);
  if (!r.ok) throw new Error("Failed to fetch comparison");
  return r.json();
}

export async function getRunOutcome(runId: string): Promise<RunOutcome> {
  const r = await fetchWithAuth(`/runs/${runId}/outcome`);
  if (!r.ok) throw new Error("Outcome not available");
  return r.json();
}

export async function getPerformanceStats(): Promise<PerformanceStats> {
  const r = await fetchWithAuth("/runs/performance");
  if (!r.ok) throw new Error("Failed to fetch performance stats");
  return r.json();
}

export async function getWatchlist(): Promise<Watchlist> {
  const r = await fetchWithAuth("/watchlist");
  if (!r.ok) throw new Error("Failed to fetch watchlist");
  return r.json();
}

export async function addWatchlistItem(req: AddWatchlistItemRequest): Promise<WatchlistItem> {
  const r = await fetchWithAuth("/watchlist/items", { method: "POST", body: JSON.stringify(req) });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Failed to add ticker");
  }
  return r.json();
}

export async function updateWatchlistItem(
  itemId: string,
  req: Partial<Pick<WatchlistItem, "schedule_cron" | "enabled" | "llm_provider" | "llm_model" | "depth" | "analysts">>
): Promise<WatchlistItem> {
  const r = await fetchWithAuth(`/watchlist/items/${itemId}`, { method: "PATCH", body: JSON.stringify(req) });
  if (!r.ok) throw new Error("Failed to update item");
  return r.json();
}

export async function removeWatchlistItem(itemId: string): Promise<void> {
  await fetchWithAuth(`/watchlist/items/${itemId}`, { method: "DELETE" });
}

export async function triggerWatchlistRun(itemId: string): Promise<{ run_id: string }> {
  const r = await fetchWithAuth(`/watchlist/items/${itemId}/run`, { method: "POST" });
  if (!r.ok) throw new Error("Failed to trigger run");
  return r.json();
}

// Portfolio
export async function listPortfolios(): Promise<Portfolio[]> {
  const r = await fetchWithAuth("/portfolio");
  if (!r.ok) throw new Error("Failed to fetch portfolios");
  return r.json();
}

export async function createPortfolio(name: string): Promise<Portfolio> {
  const r = await fetchWithAuth("/portfolio", { method: "POST", body: JSON.stringify({ name }) });
  if (!r.ok) throw new Error("Failed to create portfolio");
  return r.json();
}

export async function deletePortfolio(portfolioId: string): Promise<void> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to delete portfolio");
}

export async function uploadPortfolioSnapshot(portfolioId: string, file: File): Promise<PortfolioSnapshot> {
  const session = await getSession();
  const token = (session as { accessToken?: string })?.accessToken;
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${BASE}/portfolio/${portfolioId}/upload`, {
    method: "POST",
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error("Failed to upload snapshot");
  return r.json();
}

export async function getPortfolioCurrent(portfolioId: string): Promise<PortfolioCurrentResponse> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/current`);
  if (!r.ok) throw new Error("Failed to fetch portfolio");
  return r.json();
}

export async function listPortfolioSnapshots(portfolioId: string): Promise<PortfolioSnapshot[]> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/snapshots`);
  if (!r.ok) throw new Error("Failed to fetch snapshots");
  return r.json();
}

export async function deletePortfolioSnapshot(portfolioId: string, snapshotId: string): Promise<void> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/snapshots/${snapshotId}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to delete snapshot");
}

export async function exportPortfolioCsv(portfolioId: string): Promise<Blob> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/export`);
  if (!r.ok) throw new Error("Failed to export portfolio");
  return r.blob();
}

export async function addHolding(
  portfolioId: string,
  body: { ticker: string; shares: number; avg_cost?: number | null; currency?: string },
): Promise<{ id: string }> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/holdings`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Failed to add holding");
  return r.json();
}

export async function updateHolding(
  portfolioId: string,
  holdingId: string,
  body: { ticker?: string; shares?: number; avg_cost?: number | null; currency?: string },
): Promise<void> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/holdings/${holdingId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Failed to update holding");
}

export async function deleteHolding(portfolioId: string, holdingId: string): Promise<void> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/holdings/${holdingId}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error("Failed to delete holding");
}

// Portfolio Insights
export async function generateInsight(portfolioId: string, req: GenerateInsightRequest): Promise<PortfolioInsight> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/insights/generate`, {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Failed to start insight generation");
  }
  return r.json();
}

export async function getLatestInsight(portfolioId: string): Promise<PortfolioInsight | null> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/insights/latest`);
  if (!r.ok) throw new Error("Failed to fetch insight");
  const data = await r.json();
  return data ?? null;
}

export async function listInsights(portfolioId: string, limit = 10): Promise<PortfolioInsight[]> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/insights?limit=${limit}`);
  if (!r.ok) throw new Error("Failed to fetch insights");
  return r.json();
}

export async function getInsight(portfolioId: string, insightId: string): Promise<PortfolioInsight> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/insights/${insightId}`);
  if (!r.ok) throw new Error("Insight not found");
  return r.json();
}

export async function batchAnalyzePortfolio(
  portfolioId: string,
  req: { llm_provider: string; llm_model: string; depth: string; staleness_days?: number },
): Promise<BatchRunResult> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/runs/batch`, {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Failed to start batch analysis");
  }
  return r.json();
}

export async function getPortfolioEarnings(portfolioId: string, daysAhead = 30): Promise<EarningsEvent[]> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/earnings?days_ahead=${daysAhead}`);
  if (!r.ok) throw new Error("Failed to fetch earnings");
  const data = await r.json();
  if (data.price_unavailable_reason === "no_finnhub_key") throw new Error("no_finnhub_key");
  return data.events ?? [];
}

export async function getPortfolioFundamentals(portfolioId: string): Promise<Record<string, FundamentalsData>> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/fundamentals`);
  if (!r.ok) throw new Error("Failed to fetch fundamentals");
  const data = await r.json();
  if (data.price_unavailable_reason === "no_finnhub_key") throw new Error("no_finnhub_key");
  return data.data ?? {};
}

export async function getPortfolioNews(portfolioId: string, days = 7): Promise<NewsArticle[]> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/news?days=${days}`);
  if (!r.ok) throw new Error("Failed to fetch news");
  const data = await r.json();
  if (data.price_unavailable_reason === "no_finnhub_key") throw new Error("no_finnhub_key");
  return data.articles ?? [];
}

export async function downloadDbBackup(): Promise<Blob> {
  const session = await getSession();
  const token = (session as { accessToken?: string })?.accessToken;
  const r = await fetch(`${BASE}/admin/backup`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Failed to download backup");
  }
  return r.blob();
}

export async function restoreDbBackup(file: File): Promise<{ message: string; warnings: string | null }> {
  const session = await getSession();
  const token = (session as { accessToken?: string })?.accessToken;
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${BASE}/admin/restore`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Restore failed");
  }
  return r.json();
}

export async function getMarketTrending(): Promise<MarketTicker[]> {
  const r = await fetchWithAuth("/market/trending");
  if (!r.ok) throw new Error("Failed to fetch trending tickers");
  return r.json();
}

export async function getMarketMovers(): Promise<MoversResponse> {
  const r = await fetchWithAuth("/market/movers");
  if (!r.ok) throw new Error("Failed to fetch market movers");
  return r.json();
}

export async function getMarketSectors(): Promise<SectorData[]> {
  const r = await fetchWithAuth("/market/sectors");
  if (!r.ok) throw new Error("Failed to fetch sector data");
  return r.json();
}
