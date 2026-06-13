import { getSession, signOut } from "next-auth/react";
import type { Run, AgentEventPayload, CreateRunRequest, ApiKeyStatus, User, Report, RunStats, CompareResult, RunOutcome, PerformanceStats, Watchlist, WatchlistItem, AddWatchlistItemRequest, Portfolio, PortfolioSnapshot, PortfolioCurrentResponse, PortfolioInsight, GenerateInsightRequest, EarningsEvent, FundamentalsData, NewsArticle, BatchRunResult, TickerSnapshot, TickerMetadataResponse, MarketTicker, MoversResponse, SectorData, InvestorProfile, InvestorProfileUpsertRequest, ThesisCrossRef, BehavioralAlertsResponse, DeliverySettings, UpdateDeliverySettingsRequest, RegimeData, KalmanData, TrimSignalsResponse, WaveSummary, PortfolioEarningsResponse, PortfolioFundamentalsResponse, PortfolioNewsResponse } from "./types";
import type { AnalyzeResponse } from "./wave/types";
import type { ResponseLanguage } from "./responseLanguage";
import type { AppSettings } from "./appSettings";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function fetchWithAuth(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await getSession();
  const token = (session as { accessToken?: string })?.accessToken;
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (r.status === 401) {
    // Token expired or invalid — clear the stale session and send to login
    signOut({ callbackUrl: "/login" });
  }
  return r;
}

export async function getRuns(params?: { ticker?: string; status?: string; verdict?: string; archived?: boolean; date_from?: string; date_to?: string; limit?: number; offset?: number }): Promise<Run[]> {
  const p: Record<string, string> = {};
  if (params?.ticker) p.ticker = params.ticker;
  if (params?.status) p.status = params.status;
  if (params?.verdict) p.verdict = params.verdict;
  if (params?.archived) p.archived = "true";
  if (params?.date_from) p.date_from = params.date_from;
  if (params?.date_to) p.date_to = params.date_to;
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

export async function updateRun(id: string, data: { label?: string | null; notes?: string | null }): Promise<Run> {
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

export async function getTickerMetadata(
  tickers: string[],
  options: { forceRefresh?: boolean } = {}
): Promise<TickerMetadataResponse> {
  const symbols = Array.from(
    new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))
  ).slice(0, 50);
  if (symbols.length === 0) return { items: {} };

  const qs = new URLSearchParams({ symbols: symbols.join(",") });
  if (options.forceRefresh) qs.set("force_refresh", "true");

  const r = await fetchWithAuth(`/tickers/metadata?${qs.toString()}`);
  if (!r.ok) throw new Error("Failed to fetch ticker metadata");
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
  req: Partial<Pick<WatchlistItem, "schedule_cron" | "enabled" | "llm_provider" | "llm_model" | "depth" | "analysts" | "response_language">>
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
  req: { llm_provider: string; llm_model: string; depth: string; response_language?: ResponseLanguage; staleness_days?: number },
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

export async function getPortfolioEarnings(portfolioId: string, daysAhead = 30): Promise<PortfolioEarningsResponse> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/earnings?days_ahead=${daysAhead}`);
  if (!r.ok) throw new Error("Failed to fetch earnings");
  const data = await r.json();
  return {
    events: data.events ?? [],
    earnings_unavailable_reason: data.earnings_unavailable_reason ?? data.price_unavailable_reason ?? null,
  };
}

export async function getPortfolioFundamentals(portfolioId: string): Promise<PortfolioFundamentalsResponse> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/fundamentals`);
  if (!r.ok) throw new Error("Failed to fetch fundamentals");
  const data = await r.json();
  return {
    data: data.data ?? {},
    fundamentals_unavailable_reason: data.fundamentals_unavailable_reason ?? data.price_unavailable_reason ?? null,
  };
}

export async function getPortfolioRegime(
  portfolioId: string
): Promise<Record<string, RegimeData>> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/regime`);
  if (!r.ok) return {};
  const data = await r.json();
  return data ?? {};
}

export async function getTickerRegime(ticker: string): Promise<RegimeData | null> {
  const r = await fetchWithAuth(`/regime/${ticker}`);
  if (!r.ok) return null;
  const data = await r.json();
  return data ?? null;
}

interface AppSettingsResponse {
  observation_covariance: number;
  transition_covariance: number;
  processing_mode: "causal" | "historical";
  enable_kalman_filter: boolean;
  enable_elliott_wave: boolean;
  enable_markov_regime: boolean;
  updated_at: string | null;
}

function fromAppSettingsResponse(data: AppSettingsResponse): AppSettings {
  return {
    observationCovariance: data.observation_covariance,
    transitionCovariance: data.transition_covariance,
    mode: data.processing_mode,
    enableKalmanFilter: data.enable_kalman_filter,
    enableElliottWave: data.enable_elliott_wave,
    enableMarkovRegime: data.enable_markov_regime,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  const r = await fetchWithAuth("/settings");
  if (!r.ok) throw new Error("Failed to fetch settings");
  return fromAppSettingsResponse(await r.json());
}

export async function updateAppSettings(settings: AppSettings): Promise<AppSettings> {
  const r = await fetchWithAuth("/settings", {
    method: "PUT",
    body: JSON.stringify({
      observation_covariance: settings.observationCovariance,
      transition_covariance: settings.transitionCovariance,
      processing_mode: settings.mode,
      enable_kalman_filter: settings.enableKalmanFilter,
      enable_elliott_wave: settings.enableElliottWave,
      enable_markov_regime: settings.enableMarkovRegime,
    }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Failed to update settings");
  }
  return fromAppSettingsResponse(await r.json());
}

interface KalmanOptions {
  realTime?: boolean;
  transitionCovariance?: number;
  transitionCovarianceLevel?: number;
  transitionCovarianceTrend?: number;
  observationCovariance?: number;
}

function kalmanQuery(options: KalmanOptions = {}): string {
  const params = new URLSearchParams();
  if (options.realTime != null) params.set("real_time", String(options.realTime));
  const qLevel = options.transitionCovarianceLevel ?? options.transitionCovariance;
  const qTrend = options.transitionCovarianceTrend ?? options.transitionCovariance;
  if (qLevel != null) params.set("transition_covariance_level", String(qLevel));
  if (qTrend != null) params.set("transition_covariance_trend", String(qTrend));
  if (options.observationCovariance != null) params.set("observation_covariance", String(options.observationCovariance));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function getPortfolioKalman(
  portfolioId: string,
  options: KalmanOptions = {}
): Promise<Record<string, KalmanData>> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/kalman${kalmanQuery(options)}`);
  if (!r.ok) return {};
  const data = await r.json();
  return data ?? {};
}

export async function getTickerKalman(ticker: string, options: KalmanOptions = {}): Promise<KalmanData | null> {
  const r = await fetchWithAuth(`/kalman/${ticker}${kalmanQuery(options)}`);
  if (!r.ok) return null;
  const data = await r.json();
  return data ?? null;
}

export async function getTickerWaveSummary(ticker: string): Promise<WaveSummary | null> {
  const r = await fetchWithAuth(`/wave/${encodeURIComponent(ticker)}`);
  if (!r.ok) return null;
  const data = await r.json();
  return data ?? null;
}

export async function analyzeWave(ticker: string): Promise<AnalyzeResponse> {
  const r = await fetchWithAuth(`/wave/${encodeURIComponent(ticker)}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ period: "2y", interval: "1d", profile: "full_confluence" }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? "Wave analysis failed");
  }
  return r.json();
}

export async function getPortfolioWave(
  portfolioId: string,
): Promise<Record<string, WaveSummary>> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/wave`);
  if (!r.ok) return {};
  const data = await r.json();
  return data ?? {};
}

export async function getPortfolioTrimSignals(
  portfolioId: string
): Promise<TrimSignalsResponse> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/trim-signals`);
  if (!r.ok) return { entries: [], computed_at: "" };
  const data = await r.json();
  return data ?? { entries: [], computed_at: "" };
}

export async function getPortfolioNews(portfolioId: string, days = 7): Promise<PortfolioNewsResponse> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/news?days=${days}`);
  if (!r.ok) throw new Error("Failed to fetch news");
  const data = await r.json();
  return {
    articles: data.articles ?? [],
    news_unavailable_reason: data.news_unavailable_reason ?? data.price_unavailable_reason ?? null,
  };
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

export interface LatestRunEntry {
  run_id: string;
  verdict: "buy" | "sell" | "hold";
  completed_at: string;
}

export async function getLatestRunsByTicker(
  tickers: string[]
): Promise<Record<string, LatestRunEntry | null>> {
  if (tickers.length === 0) return {};
  const r = await fetchWithAuth(
    `/runs/latest-by-ticker?tickers=${tickers.map(encodeURIComponent).join(",")}`
  );
  if (!r.ok) throw new Error("Failed to fetch latest runs by ticker");
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

export interface SectorGap {
  sector: string;
  your_weight: number;
  sp500_weight: number;
  delta: number;
}

export interface StockRecommendation {
  ticker: string;
  tag: "Gap Fill" | "Trending" | "Mover";
  sector: string;
  reason: string;
}

export interface DiscoverResponse {
  recommendations: StockRecommendation[];
  cached: boolean;
}

export async function getSectorGaps(portfolioId: string): Promise<SectorGap[]> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/sector-gaps`);
  if (!r.ok) throw new Error("Failed to fetch sector gaps");
  return r.json();
}

export async function discoverStocks(
  portfolioId: string,
  llmProvider?: string,
  llmModel?: string
): Promise<DiscoverResponse> {
  const body: Record<string, string> = {};
  if (llmProvider) body.llm_provider = llmProvider;
  if (llmModel) body.llm_model = llmModel;
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/discover`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Failed to discover stocks");
  return r.json();
}

export async function getInvestorProfile(): Promise<InvestorProfile | null> {
  const r = await fetchWithAuth("/investor-profile/me");
  if (!r.ok) throw new Error("Failed to fetch investor profile");
  return r.json();
}

export async function upsertInvestorProfile(data: InvestorProfileUpsertRequest): Promise<InvestorProfile> {
  const r = await fetchWithAuth("/investor-profile/me", {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error("Failed to save investor profile");
  return r.json();
}

export async function deleteInvestorProfile(): Promise<void> {
  const r = await fetchWithAuth("/investor-profile/me", { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to delete investor profile");
}

export async function createThesisCrossRef(
  portfolioId: string,
  data: { thesis_text: string; llm_provider: string; llm_model: string }
): Promise<ThesisCrossRef> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/thesis-crossref`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Thesis analysis failed");
  }
  return r.json();
}

export async function getThesisCrossRefs(portfolioId: string): Promise<ThesisCrossRef[]> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/thesis-crossrefs`);
  if (!r.ok) throw new Error("Failed to fetch thesis history");
  return r.json();
}

export async function deleteThesisCrossRef(portfolioId: string, crossrefId: string): Promise<void> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/thesis-crossrefs/${crossrefId}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error("Failed to delete thesis cross-reference");
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PortfolioChatResponse {
  response: string;
  provider: string;
  model: string;
}

export async function sendPortfolioChat(
  portfolioId: string,
  message: string,
  conversationHistory: ChatMessage[],
  llmProvider: string,
  llmModel: string,
): Promise<PortfolioChatResponse> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/chat`, {
    method: "POST",
    body: JSON.stringify({
      message,
      conversation_history: conversationHistory,
      llm_provider: llmProvider,
      llm_model: llmModel,
    }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Chat request failed");
  }
  return r.json();
}

export async function getBehavioralAlerts(portfolioId: string): Promise<BehavioralAlertsResponse> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/behavioral-alerts`);
  if (!r.ok) throw new Error("Failed to fetch behavioral alerts");
  return r.json();
}

export async function getDeliverySettings(portfolioId: string): Promise<DeliverySettings> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/delivery-settings`);
  if (!r.ok) throw new Error("Failed to fetch delivery settings");
  return r.json();
}

export async function updateDeliverySettings(
  portfolioId: string,
  body: UpdateDeliverySettingsRequest
): Promise<DeliverySettings> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/delivery-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Failed to update delivery settings");
  return r.json();
}

export async function testWebhook(portfolioId: string): Promise<{ sent: boolean }> {
  const r = await fetchWithAuth(`/portfolio/${portfolioId}/delivery-settings/test-webhook`, {
    method: "POST",
  });
  if (!r.ok) {
    let detail = "Failed to test webhook";
    try { detail = (await r.json()).detail ?? detail; } catch { /* ignore parse errors */ }
    throw new Error(detail);
  }
  return r.json();
}
