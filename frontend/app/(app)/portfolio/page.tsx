"use client";
import { Suspense, useState, useEffect, useMemo, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { TickerDrawer } from "@/components/portfolio/TickerDrawer";
import { DeliverySettingsModal } from "@/components/portfolio/DeliverySettingsModal";
import { SellCandidatesPanel } from "@/components/portfolio/SellCandidatesPanel";
import { MorningBriefStrip } from "@/components/portfolio/MorningBriefStrip";
import { PortfolioTotalsSummary } from "@/components/portfolio/PortfolioTotalsSummary";
import { EmptyState } from "@/components/ui/EmptyState";
import { Briefcase } from "lucide-react";
import { DEFAULT_RESPONSE_LANGUAGE, RESPONSE_LANGUAGE_OPTIONS } from "@/lib/responseLanguage";
import type { ResponseLanguage } from "@/lib/responseLanguage";
import {
  ALERT_BANNER_CLASS,
  BTN_AI_CLASS,
  BTN_GHOST_CLASS,
  BTN_SECONDARY_CLASS,
  FIELD_INPUT_SM_CLASS,
} from "@/lib/uiClasses";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader, PageTitle } from "@/components/layout/PageHeader";
import { TabBar, type TabBarItem } from "@/components/layout/TabBar";
import {
  buildPortfolioTabGroups,
  DEFAULT_PORTFOLIO_TAB,
  legacyPortfolioTabRedirect,
  resolvePortfolioTab,
  type PortfolioTab,
  type PortfolioTabDefinition,
} from "@/lib/portfolioTabs";

const BATCH_MODAL_INPUT = `${FIELD_INPUT_SM_CLASS} w-full`;

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
                providerClassName={BATCH_MODAL_INPUT}
                modelClassName={BATCH_MODAL_INPUT}
                depthClassName={BATCH_MODAL_INPUT}
              />
              <div className="space-y-1">
                <label className="text-xs text-muted">Response Language</label>
                <select
                  value={responseLanguage}
                  onChange={(e) => setResponseLanguage(e.target.value as ResponseLanguage)}
                  className={BATCH_MODAL_INPUT}
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
                  className={`${FIELD_INPUT_SM_CLASS} w-24`}
                />
              </div>
            </div>
            {analyzeMutation.isError && (
              <p className="text-xs text-red-400">
                {(analyzeMutation.error as Error).message}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={onClose} className={BTN_GHOST_CLASS}>
                Cancel
              </button>
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className={BTN_AI_CLASS}
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
                className={BTN_GHOST_CLASS}
              >
                Run Again
              </button>
              <button
                onClick={onClose}
                className={BTN_SECONDARY_CLASS}
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

function toTabBarItem(
  def: PortfolioTabDefinition,
  alertCount: number,
): TabBarItem {
  return {
    id: def.id,
    label: def.label,
    shortLabel: def.shortLabel,
    badge: def.badge,
    alertCount: def.showAlertCount && alertCount > 0 ? alertCount : undefined,
  };
}

function PortfolioPageContent() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [preferredId, setPreferredId] = useState<string | null>(() => getLastPortfolioId());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [drawerHolding, setDrawerHolding] = useState<PortfolioHolding | null>(null);
  const [metadataForceToken, setMetadataForceToken] = useState(0);
  const [requestPortfolioCreate, setRequestPortfolioCreate] = useState(false);

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

  const tab = useMemo(
    () => resolvePortfolioTab(searchParams.get("tab"), { allCrypto }),
    [searchParams, allCrypto],
  );

  // Redirect legacy Market / Discover portfolio tabs to /market.
  useEffect(() => {
    const redirect = legacyPortfolioTabRedirect(searchParams.get("tab"));
    if (redirect) {
      router.replace(redirect);
    }
  }, [router, searchParams]);

  const setTab = useCallback(
    (next: PortfolioTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_PORTFOLIO_TAB) {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Drop invalid tab query params (e.g. earnings on an all-crypto portfolio).
  useEffect(() => {
    const fromUrl = searchParams.get("tab");
    if (legacyPortfolioTabRedirect(fromUrl)) return;
    if (!fromUrl || fromUrl === tab) return;
    setTab(tab);
  }, [searchParams, setTab, tab]);
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

  const { data: trimSignals, isFetching: fetchingTrimSignals, isError: trimSignalsError, refetch: refetchTrimSignals } = useQuery<TrimSignalsResponse>({
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
    setTab(DEFAULT_PORTFOLIO_TAB);
  }

  useEffect(() => {
    if (selectedId) {
      setLastPortfolioId(selectedId);
    }
  }, [selectedId]);

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

  const tabGroups = useMemo(
    () => buildPortfolioTabGroups({ allCrypto }),
    [allCrypto],
  );
  const primaryTabs = useMemo(
    () => tabGroups.primary.map((def) => toTabBarItem(def, alertCount)),
    [tabGroups.primary, alertCount],
  );
  const overflowTabs = useMemo(
    () => tabGroups.overflow.map((def) => toTabBarItem(def, alertCount)),
    [tabGroups.overflow, alertCount],
  );

  const hasTotals =
    current?.totals != null &&
    current.totals_currency != null &&
    current.totals.market_value != null;

  return (
    <>
    <PageShell gap="4">
        <PageHeader
          title={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <PageTitle className="shrink-0 text-xl sm:text-2xl font-semibold tracking-tight text-fg">
                Portfolio
              </PageTitle>
              <PortfolioSwitcher
                portfolios={portfolios}
                selectedId={selectedId}
                onSelect={handleSelectPortfolio}
                onCreate={(name) => createMutation.mutate(name)}
                onDelete={(id) => deleteMutation.mutate(id)}
                requestCreate={requestPortfolioCreate}
                onRequestCreateHandled={() => setRequestPortfolioCreate(false)}
              />
            </div>
          }
          actions={
            selectedPortfolio ? (
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
                {hasTotals && current?.totals && current.totals_currency && (
                  <PortfolioTotalsSummary
                    totals={current.totals}
                    totalsCurrency={current.totals_currency}
                  />
                )}
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
              </div>
            ) : undefined
          }
        />

        {selectedPortfolio && (
          <PortfolioHeader
            portfolio={selectedPortfolio}
            preferredCurrency={current?.display_currency ?? "USD"}
            portfolioCurrencies={current?.portfolio_currencies ?? []}
            snapshotDate={current?.snapshot?.uploaded_at ?? null}
            broker={current?.snapshot?.broker ?? null}
            totalsUnavailable={!hasTotals && current?.totals != null}
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
          <EmptyState
            icon={Briefcase}
            title="No portfolios yet"
            description="Create a portfolio to upload holdings, run AI analysis, and get your morning briefing."
            action={{
              label: "Create portfolio",
              onClick: () => setRequestPortfolioCreate(true),
            }}
          />
        )}

        {selectedId && loadingCurrent && (
          <div className="text-muted text-sm">Loading portfolio…</div>
        )}

        {!loadingPortfolios && (
          <TabBar
            primaryTabs={primaryTabs}
            overflowTabs={overflowTabs}
            activeId={tab}
            tabIdPrefix="portfolio-tab"
            onChange={(id) => setTab(id as PortfolioTab)}
          />
        )}

        {/* Tab panels — fixed-width container prevents layout shift between tabs */}
        <div className="min-w-0 w-full overflow-x-hidden">
        {selectedId && !loadingCurrent && current && (
          <>
            {tab === "holdings" && (
              <div
                id="portfolio-panel-holdings"
                role="tabpanel"
                aria-labelledby="portfolio-tab-holdings"
                className="space-y-3"
              >
                <MorningBriefStrip
                  portfolioId={selectedId}
                  onOpenInsights={() => setTab("insights")}
                />
                {hasHoldings && (
                  <PortfolioStatsBar
                    holdings={current.holdings}
                    onAnalyzeStale={() => setBatchOpen(true)}
                    fundamentals={fundamentals}
                    regime={markovEnabled ? regime : undefined}
                    trimSignals={markovEnabled ? trimByHoldingId : undefined}
                  />
                )}
                {markovEnabled && trimSignalsError && (
                  <div className={ALERT_BANNER_CLASS}>
                    Trim signals could not be loaded. Sell-candidate flags may be incomplete.{" "}
                    <button
                      type="button"
                      onClick={() => refetchTrimSignals()}
                      className="text-blue-400 hover:text-blue-300 underline"
                    >
                      Retry
                    </button>
                  </div>
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
                  onUploadClick={() => setUploadOpen(true)}
                />
              </div>
            )}

            {tab === "insights" && (
              <div
                id="portfolio-panel-insights"
                role="tabpanel"
                aria-labelledby="portfolio-tab-insights"
              >
              <InsightsDashboard
                portfolioId={selectedId}
                hasHoldings={hasHoldings}
                portfolioName={selectedPortfolio?.name}
              />
              </div>
            )}

            {tab === "earnings" && (
              <div
                id="portfolio-panel-earnings"
                role="tabpanel"
                aria-labelledby="portfolio-tab-earnings"
              >
              <EarningsPanel
                portfolioId={selectedId}
                holdings={current.holdings}
                priceUnavailableReason={current.price_unavailable_reason}
              />
              </div>
            )}

            {tab === "news" && (
              <div
                id="portfolio-panel-news"
                role="tabpanel"
                aria-labelledby="portfolio-tab-news"
              >
              <NewsPanel
                portfolioId={selectedId}
                priceUnavailableReason={current.price_unavailable_reason}
              />
              </div>
            )}

            {tab === "chat" && selectedId && (
              <div
                id="portfolio-panel-chat"
                role="tabpanel"
                aria-labelledby="portfolio-tab-chat"
              >
              <ChatPanel portfolioId={selectedId} />
              </div>
            )}

            {tab === "thesis" && selectedId && (
              <div
                id="portfolio-panel-thesis"
                role="tabpanel"
                aria-labelledby="portfolio-tab-thesis"
              >
              <ThesisPanel portfolioId={selectedId} />
              </div>
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

export default function PortfolioPage() {
  return (
    <Suspense fallback={
      <PageShell gap="4">
        <PageHeader title={<PageTitle>Portfolio</PageTitle>} />
        <div className="text-muted text-sm">Loading…</div>
      </PageShell>
    }>
      <PortfolioPageContent />
    </Suspense>
  );
}
