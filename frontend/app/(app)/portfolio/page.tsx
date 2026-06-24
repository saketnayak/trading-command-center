"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listPortfolios,
  createPortfolio,
  deletePortfolio,
  uploadPortfolioSnapshot,
  getPortfolioCurrent,
  exportPortfolioCsv,
  getPortfolioFundamentals,
  getPortfolioRegime,
  getPortfolioWave,
  getPortfolioTrimSignals,
  batchAnalyzePortfolio,
  getBehavioralAlerts,
  getAppSettings,
  getPortfolioNews,
  getPortfolioEarnings,
  getMarketTrending,
  getMarketMovers,
  getMarketSectors,
} from "@/lib/api";
import { LlmConfigPicker, type LlmConfigValue } from "@/components/llm/LlmConfigPicker";
import { useDefaultLlmConfig } from "@/lib/useDefaultLlmConfig";
import { DEFAULT_LLM_DEPTH } from "@/lib/llmConfig";
import type { Portfolio, PortfolioHolding, BehavioralAlertsResponse, RegimeData, WaveSummary, TrimSignalEntry, TrimSignalsResponse } from "@/lib/types";
import { isCrypto } from "@/lib/asset";
import {
  getLastPortfolioId,
  resolvePortfolioId,
  setLastPortfolioId,
} from "@/lib/portfolioSelection";
import {
  portfolioQueryKeys,
  marketQueryKeys,
  PORTFOLIO_STALE_TIMES,
  MARKET_STALE_TIMES,
  PORTFOLIO_NEWS_DAYS,
  PORTFOLIO_EARNINGS_DAYS_AHEAD,
} from "@/lib/portfolioQueries";
import { usePortfolioSync } from "@/lib/usePortfolioSync";
import { PortfolioFreshnessLabel } from "@/lib/usePortfolioFreshness";
import { useTickerMetadata } from "@/lib/useTickerMetadata";
import { PortfolioSwitcher } from "@/components/portfolio/PortfolioSwitcher";
import { PortfolioActions } from "@/components/portfolio/PortfolioActions";
import { PortfolioHeader } from "@/components/portfolio/PortfolioHeader";
import { UploadDrawer } from "@/components/portfolio/UploadDrawer";
import { HoldingsTable } from "@/components/portfolio/HoldingsTable";
import { InsightsDashboard } from "@/components/portfolio/InsightsDashboard";
import { PortfolioStatsBar } from "@/components/portfolio/PortfolioStatsBar";
import { EarningsPanel } from "@/components/portfolio/EarningsPanel";
import { NewsPanel } from "@/components/portfolio/NewsPanel";
import { ChatPanel } from "@/components/portfolio/ChatPanel";
import { ThesisPanel } from "@/components/portfolio/ThesisPanel";
import { TrendingPanel } from "@/components/portfolio/TrendingPanel";
import { TickerDrawer } from "@/components/portfolio/TickerDrawer";
import { DiscoverPanel } from "@/components/portfolio/DiscoverPanel";
import { DeliverySettingsModal } from "@/components/portfolio/DeliverySettingsModal";
import { SellCandidatesPanel } from "@/components/portfolio/SellCandidatesPanel";
import { DEFAULT_RESPONSE_LANGUAGE, RESPONSE_LANGUAGE_OPTIONS } from "@/lib/responseLanguage";
import type { ResponseLanguage } from "@/lib/responseLanguage";
import { PageShell } from "@/components/layout/PageShell";
import { PageTitle } from "@/components/layout/PageHeader";

type Tab = "holdings" | "insights" | "earnings" | "news" | "trending" | "discover" | "chat" | "thesis";

function BatchAnalyzeModal({
  portfolioId,
  onClose,
}: {
  portfolioId: string;
  onClose: () => void;
}) {
  const { provider, model, depth, resolveModel } = useDefaultLlmConfig();
  const [llmConfig, setLlmConfig] = useState<LlmConfigValue>({ provider, model, depth });
  const [responseLanguage, setResponseLanguage] = useState<ResponseLanguage>(DEFAULT_RESPONSE_LANGUAGE);
  const [stalenessDays, setStalenessDays] = useState(7);
  const [result, setResult] = useState<{ queued: { ticker: string; run_id: string }[]; skipped: string[] } | null>(null);

  useEffect(() => {
    setLlmConfig({ provider, model, depth });
  }, [provider, model, depth]);

  const analyzeMutation = useMutation({
    mutationFn: () =>
      batchAnalyzePortfolio(portfolioId, {
        llm_provider: llmConfig.provider,
        llm_model: resolveModel(llmConfig),
        depth: llmConfig.depth ?? DEFAULT_LLM_DEPTH,
        response_language: responseLanguage,
        staleness_days: stalenessDays,
      }),
    onSuccess: (data) => setResult({ queued: data.queued, skipped: data.skipped }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="bg-elevated border border-input-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-fg">Analyze All Stale Holdings</h2>
          <button onClick={onClose} className="text-muted hover:text-fg-secondary text-lg">✕</button>
        </div>

        {!result ? (
          <>
            <p className="text-xs text-muted">
              Queues a new analysis run for every holding whose last analysis is older than the threshold (or has never been analyzed).
            </p>
            <div className="space-y-3">
              <LlmConfigPicker
                value={llmConfig}
                onChange={setLlmConfig}
                showDepth
                providerClassName="w-full bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
                modelClassName="w-full bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
                depthClassName="w-full bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
              />
              <div className="space-y-1">
                <label className="text-xs text-muted">Response Language</label>
                <select
                  value={responseLanguage}
                  onChange={(e) => setResponseLanguage(e.target.value as ResponseLanguage)}
                  className="w-full bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
                >
                  {RESPONSE_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted">
                  Staleness threshold (days) — skip if analyzed within this many days
                </label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={stalenessDays}
                  onChange={(e) => setStalenessDays(parseInt(e.target.value) || 7)}
                  className="w-24 bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
                />
              </div>
            </div>
            {analyzeMutation.isError && (
              <p className="text-xs text-red-400">
                {(analyzeMutation.error as Error).message}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-muted hover:text-fg">
                Cancel
              </button>
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className="px-4 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 text-fg rounded-sm disabled:opacity-50 transition-colors"
              >
                {analyzeMutation.isPending ? "Starting…" : "Start Batch Analysis"}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-green-400 mb-1">
                {result.queued.length} run{result.queued.length !== 1 ? "s" : ""} queued
              </p>
              {result.queued.length > 0 && (
                <p className="text-xs text-muted font-mono">{result.queued.map((q) => q.ticker).join(", ")}</p>
              )}
            </div>
            {result.skipped.length > 0 && (
              <div>
                <p className="text-xs text-muted mb-1">{result.skipped.length} skipped (recently analyzed):</p>
                <p className="text-xs text-muted font-mono">{result.skipped.join(", ")}</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setResult(null)}
                className="px-3 py-1.5 text-sm text-muted hover:text-fg"
              >
                Run Again
              </button>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-sm bg-muted-surface hover:bg-muted-surface text-fg rounded-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const queryClient = useQueryClient();
  const [preferredId, setPreferredId] = useState<string | null>(() => getLastPortfolioId());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("holdings");
  const [batchOpen, setBatchOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [drawerHolding, setDrawerHolding] = useState<PortfolioHolding | null>(null);
  const [metadataForceToken, setMetadataForceToken] = useState(0);

  const { data: portfolios = [], isLoading: loadingPortfolios } = useQuery({
    queryKey: portfolioQueryKeys.list,
    queryFn: listPortfolios,
  });

  const selectedId = useMemo(
    () => resolvePortfolioId(portfolios, preferredId),
    [portfolios, preferredId]
  );

  const { data: current, isLoading: loadingCurrent, isFetching: fetchingCurrent, refetch: refetchCurrent } = useQuery({
    queryKey: portfolioQueryKeys.current(selectedId ?? ""),
    queryFn: () => getPortfolioCurrent(selectedId!),
    enabled: selectedId != null,
    staleTime: PORTFOLIO_STALE_TIMES.current,
  });

  const hasHoldings = (current?.holdings?.length ?? 0) > 0;
  const allCrypto = hasHoldings && (current?.holdings ?? []).every((h) => isCrypto(h.ticker));
  const tickers = useMemo(
    () => (current?.holdings ?? []).map((h) => h.ticker),
    [current?.holdings]
  );

  const { data: strategySettings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: getAppSettings,
    retry: false,
  });
  const markovEnabled = strategySettings?.enableMarkovRegime !== false;
  const waveEnabled = strategySettings?.enableElliottWave !== false;

  const { data: fundamentalsResult, isFetching: fetchingFundamentals } = useQuery({
    queryKey: portfolioQueryKeys.fundamentals(selectedId ?? ""),
    queryFn: () => getPortfolioFundamentals(selectedId!),
    enabled: selectedId != null,
    staleTime: PORTFOLIO_STALE_TIMES.fundamentals,
  });
  const fundamentals = fundamentalsResult?.data;
  const fundamentalsUnavailableReason = fundamentalsResult?.fundamentals_unavailable_reason ?? null;

  const { data: regime = {}, isFetching: fetchingRegime } = useQuery<Record<string, RegimeData>>({
    queryKey: portfolioQueryKeys.regime(selectedId ?? ""),
    queryFn: () => getPortfolioRegime(selectedId!),
    enabled: selectedId != null && markovEnabled,
    staleTime: PORTFOLIO_STALE_TIMES.regime,
  });

  const { data: wave = {}, isFetching: fetchingWave } = useQuery<Record<string, WaveSummary>>({
    queryKey: portfolioQueryKeys.wave(selectedId ?? ""),
    queryFn: () => getPortfolioWave(selectedId!),
    enabled: selectedId != null && waveEnabled,
    staleTime: PORTFOLIO_STALE_TIMES.wave,
  });

  const { data: trimSignals, isFetching: fetchingTrimSignals } = useQuery<TrimSignalsResponse>({
    queryKey: portfolioQueryKeys.trimSignals(selectedId ?? ""),
    queryFn: () => getPortfolioTrimSignals(selectedId!),
    enabled: selectedId != null && markovEnabled,
    staleTime: PORTFOLIO_STALE_TIMES.trimSignals,
  });

  const trimByHoldingId = useMemo<Record<string, TrimSignalEntry>>(
    () => Object.fromEntries((trimSignals?.entries ?? []).map((e) => [e.holding_id, e])),
    [trimSignals]
  );

  const { data: behavioralAlerts, isFetching: fetchingBehavioralAlerts } = useQuery<BehavioralAlertsResponse>({
    queryKey: portfolioQueryKeys.behavioralAlerts(selectedId ?? ""),
    queryFn: () => getBehavioralAlerts(selectedId!),
    enabled: selectedId != null,
    staleTime: PORTFOLIO_STALE_TIMES.behavioralAlerts,
  });
  const alertCount = (behavioralAlerts?.critical_count ?? 0) + (behavioralAlerts?.warning_count ?? 0);

  const noFinnhubKey = current?.price_unavailable_reason === "no_finnhub_key";

  const { isFetching: fetchingNews } = useQuery({
    queryKey: portfolioQueryKeys.news(selectedId ?? ""),
    queryFn: () => getPortfolioNews(selectedId!, PORTFOLIO_NEWS_DAYS),
    enabled: selectedId != null && !noFinnhubKey,
    staleTime: PORTFOLIO_STALE_TIMES.news,
  });

  const { isFetching: fetchingEarnings } = useQuery({
    queryKey: portfolioQueryKeys.earnings(selectedId ?? ""),
    queryFn: () => getPortfolioEarnings(selectedId!, PORTFOLIO_EARNINGS_DAYS_AHEAD),
    enabled: selectedId != null && !allCrypto && !noFinnhubKey,
    staleTime: PORTFOLIO_STALE_TIMES.earnings,
  });

  const { isFetching: fetchingMarketTrending } = useQuery({
    queryKey: marketQueryKeys.trending,
    queryFn: getMarketTrending,
    staleTime: MARKET_STALE_TIMES.trending,
    retry: 1,
  });

  const { isFetching: fetchingMarketMovers } = useQuery({
    queryKey: marketQueryKeys.movers,
    queryFn: getMarketMovers,
    staleTime: MARKET_STALE_TIMES.movers,
    retry: 1,
  });

  const { isFetching: fetchingMarketSectors } = useQuery({
    queryKey: marketQueryKeys.sectors,
    queryFn: getMarketSectors,
    staleTime: MARKET_STALE_TIMES.sectors,
    retry: 1,
  });

  const { data: tickerMetadata = {}, isFetching: fetchingTickerMetadata } = useTickerMetadata(tickers, {
    enabled: tickers.length > 0,
    forceRefresh: metadataForceToken > 0,
  });

  const handleMetadataForceRefresh = useCallback(() => {
    setMetadataForceToken((token) => token + 1);
  }, []);

  const { syncAll, isSyncing } = usePortfolioSync({
    portfolioId: selectedId,
    activeTab: tab,
    markovEnabled,
    waveEnabled,
    onMetadataForceRefresh: handleMetadataForceRefresh,
  });

  const isFetchingPortfolioData =
    fetchingCurrent ||
    isSyncing ||
    fetchingFundamentals ||
    fetchingRegime ||
    fetchingWave ||
    fetchingTrimSignals ||
    fetchingBehavioralAlerts ||
    fetchingTickerMetadata ||
    fetchingNews ||
    fetchingEarnings ||
    fetchingMarketTrending ||
    fetchingMarketMovers ||
    fetchingMarketSectors;

  function handleSelectPortfolio(id: string) {
    setPreferredId(id);
    setLastPortfolioId(id);
    setTab("holdings");
  }

  useEffect(() => {
    if (selectedId) {
      setLastPortfolioId(selectedId);
    }
  }, [selectedId]);

  // Open upload drawer when selected portfolio has no snapshot yet
  useEffect(() => {
    if (selectedId != null && !loadingCurrent && current !== undefined && current.snapshot === null) {
      setUploadOpen(true);
    }
  }, [selectedId, current, loadingCurrent]);

  const createMutation = useMutation({
    mutationFn: (name: string) => createPortfolio(name),
    onSuccess: (p: Portfolio) => {
      queryClient.invalidateQueries({ queryKey: portfolioQueryKeys.list });
      setPreferredId(p.id);
      setLastPortfolioId(p.id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePortfolio(id),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: portfolioQueryKeys.list });
      if (preferredId === deletedId) {
        setPreferredId(null);
      }
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPortfolioSnapshot(selectedId!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portfolioQueryKeys.current(selectedId!) });
      setUploadOpen(false);
    },
  });

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;

  async function handleExport() {
    if (!selectedId || !selectedPortfolio) return;
    const blob = await exportPortfolioCsv(selectedId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-${selectedPortfolio.name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasMissingPrices = (current?.holdings ?? []).some(
    (h) => h.current_price == null && current?.price_unavailable_reason !== "no_finnhub_key"
  );

  const TABS: Array<{ id: Tab; label: string; badge?: string; alertCount?: number }> = [
    { id: "holdings", label: "Holdings" },
    { id: "insights", label: "AI Insights", badge: "✦", alertCount: alertCount > 0 ? alertCount : undefined },
    ...(!allCrypto ? [{ id: "earnings" as Tab, label: "Earnings" }] : []),
    { id: "news", label: "News" },
    { id: "chat", label: "Chat" },
    { id: "thesis", label: "Thesis" },
    { id: "trending", label: "Market", badge: "↑" },
  ];

  return (
    <>
    <PageShell width="none" gap="4">
        <PageTitle>Portfolio</PageTitle>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <PortfolioSwitcher
            portfolios={portfolios}
            selectedId={selectedId}
            onSelect={handleSelectPortfolio}
            onCreate={(name) => createMutation.mutate(name)}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
          {selectedPortfolio && (
            <>
              <div className="hidden sm:block h-6 w-px shrink-0 bg-border" aria-hidden="true" />
              <PortfolioActions
                freshnessLabel={
                  <PortfolioFreshnessLabel
                    portfolioId={selectedId}
                    markovEnabled={markovEnabled}
                    waveEnabled={waveEnabled}
                    isFetching={isFetchingPortfolioData}
                  />
                }
                hasMissingPrices={hasMissingPrices}
                isRefreshing={fetchingCurrent}
                isSyncing={isSyncing}
                onRefreshClick={() => refetchCurrent()}
                onSyncAllClick={() => syncAll()}
                onUploadClick={() => setUploadOpen(true)}
                onExportClick={handleExport}
                onDeliveryClick={() => setDeliveryOpen(true)}
              />
            </>
          )}
        </div>

        {selectedPortfolio && (
          <PortfolioHeader
            portfolio={selectedPortfolio}
            totals={current?.totals ?? null}
            totalsCurrency={current?.totals_currency ?? null}
            preferredCurrency={current?.display_currency ?? "USD"}
            portfolioCurrencies={current?.portfolio_currencies ?? []}
            snapshotDate={current?.snapshot?.uploaded_at ?? null}
            broker={current?.snapshot?.broker ?? null}
          />
        )}

        <UploadDrawer
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUpload={(file) => uploadMutation.mutate(file)}
          uploading={uploadMutation.isPending}
        />
        {selectedId && (
          <DeliverySettingsModal
            portfolioId={selectedId}
            open={deliveryOpen}
            onClose={() => setDeliveryOpen(false)}
          />
        )}

        {selectedId === null && portfolios.length === 0 && !loadingPortfolios && (
          <p className="text-muted text-sm text-center py-10">
            No portfolios yet. Create one above to get started.
          </p>
        )}

        {selectedId && loadingCurrent && tab !== "trending" && (
          <div className="text-muted text-sm">Loading portfolio…</div>
        )}

        {/* Tab bar — Market tab is always accessible; portfolio tabs require a loaded portfolio */}
        {!loadingPortfolios && (
          <div className="flex gap-1 border-b border-border overflow-x-auto scrollbar-thin">
            {selectedId && current && TABS.filter((t) => t.id !== "trending").map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                  tab === t.id
                    ? "border-purple-500 text-fg"
                    : "border-transparent text-muted hover:text-fg"
                }`}
              >
                <span>{t.label}</span>
                {t.alertCount != null && (
                  <span className="text-xs px-1 py-0.5 bg-red-500 text-fg rounded-sm font-mono leading-none min-w-[16px] text-center">
                    {t.alertCount}
                  </span>
                )}
                {!t.alertCount && t.badge && <span className="text-purple-400 text-xs">{t.badge}</span>}
              </button>
            ))}
            <button
              onClick={() => setTab("trending")}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                tab === "trending"
                  ? "border-purple-500 text-fg"
                  : "border-transparent text-muted hover:text-fg"
              }`}
            >
              <span>Market</span>
              <span className="text-purple-400 text-xs">↑</span>
            </button>
            {selectedId && current && (
              <button
                onClick={() => setTab("discover")}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === "discover"
                    ? "border-violet-500 text-violet-400"
                    : "border-transparent text-muted hover:text-fg"
                }`}
              >
                Discover 🔍
              </button>
            )}
          </div>
        )}

        {/* Tab panels — fixed-width container prevents layout shift between tabs */}
        <div className="min-w-0 w-full overflow-x-hidden">
        {tab === "trending" && <TrendingPanel />}

        {tab === "discover" && selectedPortfolio && (
          <DiscoverPanel portfolioId={selectedPortfolio.id} />
        )}

        {selectedId && !loadingCurrent && current && tab !== "trending" && tab !== "discover" && (
          <>
            {tab === "holdings" && (
              <div className="space-y-3">
                {hasHoldings && (
                  <PortfolioStatsBar
                    holdings={current.holdings}
                    onAnalyzeStale={() => setBatchOpen(true)}
                    fundamentals={fundamentals}
                    regime={markovEnabled ? regime : undefined}
                    trimSignals={markovEnabled ? trimByHoldingId : undefined}
                  />
                )}
                {markovEnabled && (
                  <SellCandidatesPanel
                    entries={trimSignals?.entries ?? []}
                    computedAt={trimSignals?.computed_at}
                  />
                )}
                <HoldingsTable
                  portfolioId={selectedId}
                  holdings={current.holdings}
                  priceUnavailableReason={current.price_unavailable_reason}
                  fundamentalsUnavailableReason={fundamentalsUnavailableReason}
                  displayCurrency={current.display_currency ?? "USD"}
                  fundamentals={fundamentals}
                  regime={markovEnabled ? regime : undefined}
                  wave={waveEnabled ? wave : undefined}
                  trimSignals={markovEnabled ? trimByHoldingId : undefined}
                  tickerMetadata={tickerMetadata}
                  onTickerClick={setDrawerHolding}
                />
              </div>
            )}

            {tab === "insights" && (
              <InsightsDashboard
                portfolioId={selectedId}
                hasHoldings={hasHoldings}
                portfolioName={selectedPortfolio?.name}
              />
            )}

            {tab === "earnings" && (
              <EarningsPanel
                portfolioId={selectedId}
                holdings={current.holdings}
                priceUnavailableReason={current.price_unavailable_reason}
              />
            )}

            {tab === "news" && (
              <NewsPanel
                portfolioId={selectedId}
                priceUnavailableReason={current.price_unavailable_reason}
              />
            )}

            {tab === "chat" && selectedId && (
              <ChatPanel portfolioId={selectedId} />
            )}

            {tab === "thesis" && selectedId && (
              <ThesisPanel portfolioId={selectedId} />
            )}
          </>
        )}
        </div>
      </PageShell>

      {batchOpen && selectedId && (
        <BatchAnalyzeModal
          portfolioId={selectedId}
          onClose={() => setBatchOpen(false)}
        />
      )}

      <TickerDrawer
        holding={drawerHolding}
        displayCurrency={current?.display_currency ?? "USD"}
        onClose={() => setDrawerHolding(null)}
        waveEnabled={waveEnabled}
      />
    </>
  );
}
