"use client";
import { useState, useEffect, useMemo } from "react";
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
  getProviderModels,
  getBehavioralAlerts,
  getAppSettings,
} from "@/lib/api";
import type { Portfolio, PortfolioHolding, BehavioralAlertsResponse, RegimeData, WaveSummary, TrimSignalEntry, TrimSignalsResponse } from "@/lib/types";
import { isCrypto } from "@/lib/asset";
import { PortfolioSwitcher } from "@/components/portfolio/PortfolioSwitcher";
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

type Tab = "holdings" | "insights" | "earnings" | "news" | "trending" | "discover" | "chat" | "thesis";

const PROVIDERS = ["openai", "anthropic", "google", "groq", "ionos", "ollama", "vllm"];
const DEPTHS = ["quick", "standard", "deep"] as const;

interface BatchAnalyzeForm {
  llm_provider: string;
  llm_model: string;
  depth: string;
  response_language: ResponseLanguage;
  staleness_days: number;
}

function BatchAnalyzeModal({
  portfolioId,
  onClose,
}: {
  portfolioId: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState<BatchAnalyzeForm>({
    llm_provider: "openai",
    llm_model: "",
    depth: "quick",
    response_language: DEFAULT_RESPONSE_LANGUAGE,
    staleness_days: 7,
  });
  const [result, setResult] = useState<{ queued: { ticker: string; run_id: string }[]; skipped: string[] } | null>(null);

  const { data: models = [] } = useQuery({
    queryKey: ["provider-models", form.llm_provider],
    queryFn: () => getProviderModels(form.llm_provider),
  });

  useEffect(() => {
    if (models.length > 0 && !form.llm_model) {
      setForm((f) => ({ ...f, llm_model: models[0] }));
    }
  }, [models, form.llm_model]);

  const analyzeMutation = useMutation({
    mutationFn: () =>
      batchAnalyzePortfolio(portfolioId, {
        llm_provider: form.llm_provider,
        llm_model: form.llm_model || (models[0] ?? ""),
        depth: form.depth,
        response_language: form.response_language,
        staleness_days: form.staleness_days,
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted">Provider</label>
                  <select
                    value={form.llm_provider}
                    onChange={(e) => setForm((f) => ({ ...f, llm_provider: e.target.value, llm_model: "" }))}
                    className="w-full bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
                  >
                    {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted">Depth</label>
                  <select
                    value={form.depth}
                    onChange={(e) => setForm((f) => ({ ...f, depth: e.target.value }))}
                    className="w-full bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
                  >
                    {DEPTHS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted">Model</label>
                <select
                  value={form.llm_model}
                  onChange={(e) => setForm((f) => ({ ...f, llm_model: e.target.value }))}
                  className="w-full bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
                >
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted">Response Language</label>
                <select
                  value={form.response_language}
                  onChange={(e) => setForm((f) => ({ ...f, response_language: e.target.value as ResponseLanguage }))}
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
                  value={form.staleness_days}
                  onChange={(e) => setForm((f) => ({ ...f, staleness_days: parseInt(e.target.value) || 7 }))}
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("holdings");
  const [batchOpen, setBatchOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [drawerHolding, setDrawerHolding] = useState<PortfolioHolding | null>(null);

  const { data: portfolios = [], isLoading: loadingPortfolios } = useQuery({
    queryKey: ["portfolios"],
    queryFn: listPortfolios,
  });

  const { data: current, isLoading: loadingCurrent, isFetching: fetchingCurrent, refetch: refetchCurrent } = useQuery({
    queryKey: ["portfolio-current", selectedId],
    queryFn: () => getPortfolioCurrent(selectedId!),
    enabled: selectedId != null,
  });

  const hasHoldings = (current?.holdings?.length ?? 0) > 0;
  const allCrypto = hasHoldings && (current?.holdings ?? []).every((h) => isCrypto(h.ticker));

  const { data: strategySettings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: getAppSettings,
    retry: false,
  });
  const markovEnabled = strategySettings?.enableMarkovRegime !== false;
  const waveEnabled = strategySettings?.enableElliottWave !== false;

  // Fetch fundamentals when holdings tab is active.
  // Crypto uses CoinGecko (no key needed); stocks need a Finnhub key.
  const { data: fundamentals } = useQuery({
    queryKey: ["portfolio-fundamentals", selectedId],
    queryFn: () => getPortfolioFundamentals(selectedId!),
    enabled: selectedId != null && tab === "holdings" && (allCrypto || current?.price_unavailable_reason !== "no_finnhub_key"),
    staleTime: 1000 * 60 * 30,
  });

  const { data: regime = {} } = useQuery<Record<string, RegimeData>>({
    queryKey: ["portfolio-regime", selectedId],
    queryFn: () => getPortfolioRegime(selectedId!),
    enabled: selectedId != null && tab === "holdings" && markovEnabled,
    staleTime: 1000 * 60 * 60 * 4,  // 4h — matches backend cache TTL
  });

  const { data: wave = {} } = useQuery<Record<string, WaveSummary>>({
    queryKey: ["portfolio-wave", selectedId],
    queryFn: () => getPortfolioWave(selectedId!),
    enabled: selectedId != null && tab === "holdings" && waveEnabled,
    staleTime: 1000 * 60 * 60 * 4,
  });

  const { data: trimSignals } = useQuery<TrimSignalsResponse>({
    queryKey: ["portfolio-trim-signals", selectedId],
    queryFn: () => getPortfolioTrimSignals(selectedId!),
    enabled: selectedId != null && tab === "holdings" && markovEnabled,
    staleTime: 1000 * 60 * 30,
  });

  const trimByHoldingId = useMemo<Record<string, TrimSignalEntry>>(
    () => Object.fromEntries((trimSignals?.entries ?? []).map((e) => [e.holding_id, e])),
    [trimSignals]
  );

  const { data: behavioralAlerts } = useQuery<BehavioralAlertsResponse>({
    queryKey: ["behavioralAlerts", selectedId],
    queryFn: () => getBehavioralAlerts(selectedId!),
    enabled: selectedId != null && tab === "insights",
    staleTime: 1000 * 60 * 5,
  });
  const alertCount = (behavioralAlerts?.critical_count ?? 0) + (behavioralAlerts?.warning_count ?? 0);

  // Auto-select first portfolio on load
  useEffect(() => {
    if (selectedId === null && portfolios.length > 0) {
      setSelectedId(portfolios[0].id);
    }
  }, [portfolios, selectedId]);

  // Open upload drawer when selected portfolio has no snapshot yet
  useEffect(() => {
    if (selectedId != null && !loadingCurrent && current !== undefined && current.snapshot === null) {
      setUploadOpen(true);
    }
  }, [selectedId, current, loadingCurrent]);

  const createMutation = useMutation({
    mutationFn: (name: string) => createPortfolio(name),
    onSuccess: (p: Portfolio) => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setSelectedId(p.id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePortfolio(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setSelectedId(null);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPortfolioSnapshot(selectedId!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-current", selectedId] });
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
    <main className="max-w-screen-2xl mx-auto px-4 py-4 sm:px-6 sm:py-6 space-y-4">
        <h1 className="text-lg font-semibold text-fg">Portfolio</h1>

        <div className="flex items-center gap-4">
          <PortfolioSwitcher
            portfolios={portfolios}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setTab("holdings"); }}
            onCreate={(name) => createMutation.mutate(name)}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        </div>

        {selectedPortfolio && (
          <PortfolioHeader
            portfolio={selectedPortfolio}
            totals={current?.totals ?? null}
            displayCurrency={current?.display_currency ?? "USD"}
            snapshotDate={current?.snapshot?.uploaded_at ?? null}
            broker={current?.snapshot?.broker ?? null}
            hasMissingPrices={hasMissingPrices}
            isRefreshing={fetchingCurrent}
            onUploadClick={() => setUploadOpen(true)}
            onExportClick={handleExport}
            onDeliveryClick={() => setDeliveryOpen(true)}
            onRefreshClick={() => refetchCurrent()}
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

        {/* Market panel — available regardless of portfolio selection */}
        {tab === "trending" && <TrendingPanel />}

        {tab === "discover" && selectedPortfolio && (
          <DiscoverPanel portfolioId={selectedPortfolio.id} />
        )}

        {/* Portfolio tab panels — require a loaded portfolio */}
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
                  displayCurrency={current.display_currency ?? "USD"}
                  fundamentals={fundamentals}
                  regime={markovEnabled ? regime : undefined}
                  wave={waveEnabled ? wave : undefined}
                  trimSignals={markovEnabled ? trimByHoldingId : undefined}
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
      </main>

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
