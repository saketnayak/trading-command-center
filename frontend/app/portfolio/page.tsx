"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopNav } from "@/components/layout/TopNav";
import {
  listPortfolios,
  createPortfolio,
  deletePortfolio,
  uploadPortfolioSnapshot,
  getPortfolioCurrent,
  exportPortfolioCsv,
  getPortfolioFundamentals,
  batchAnalyzePortfolio,
  getProviderModels,
} from "@/lib/api";
import type { Portfolio, PortfolioHolding } from "@/lib/types";
import { isCrypto } from "@/lib/asset";
import { PortfolioSwitcher } from "@/components/portfolio/PortfolioSwitcher";
import { PortfolioHeader } from "@/components/portfolio/PortfolioHeader";
import { UploadDrawer } from "@/components/portfolio/UploadDrawer";
import { HoldingsTable } from "@/components/portfolio/HoldingsTable";
import { InsightsDashboard } from "@/components/portfolio/InsightsDashboard";
import { PortfolioStatsBar } from "@/components/portfolio/PortfolioStatsBar";
import { EarningsPanel } from "@/components/portfolio/EarningsPanel";
import { NewsPanel } from "@/components/portfolio/NewsPanel";
import { TrendingPanel } from "@/components/portfolio/TrendingPanel";
import { TickerDrawer } from "@/components/portfolio/TickerDrawer";

type Tab = "holdings" | "insights" | "earnings" | "news" | "trending";

const PROVIDERS = ["openai", "anthropic", "google", "groq", "ollama", "vllm"];
const DEPTHS = ["quick", "standard", "deep"] as const;

interface BatchAnalyzeForm {
  llm_provider: string;
  llm_model: string;
  depth: string;
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
        staleness_days: form.staleness_days,
      }),
    onSuccess: (data) => setResult({ queued: data.queued, skipped: data.skipped }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-navy-800 border border-slate-700 rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Analyze All Stale Holdings</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">✕</button>
        </div>

        {!result ? (
          <>
            <p className="text-xs text-slate-400">
              Queues a new analysis run for every holding whose last analysis is older than the threshold (or has never been analyzed).
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Provider</label>
                  <select
                    value={form.llm_provider}
                    onChange={(e) => setForm((f) => ({ ...f, llm_provider: e.target.value, llm_model: "" }))}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Depth</label>
                  <select
                    value={form.depth}
                    onChange={(e) => setForm((f) => ({ ...f, depth: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    {DEPTHS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Model</label>
                <select
                  value={form.llm_model}
                  onChange={(e) => setForm((f) => ({ ...f, llm_model: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">
                  Staleness threshold (days) — skip if analyzed within this many days
                </label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={form.staleness_days}
                  onChange={(e) => setForm((f) => ({ ...f, staleness_days: parseInt(e.target.value) || 7 }))}
                  className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            {analyzeMutation.isError && (
              <p className="text-xs text-red-400">
                {(analyzeMutation.error as Error).message}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className="px-4 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-50 transition-colors"
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
                <p className="text-xs text-slate-400 font-mono">{result.queued.map((q) => q.ticker).join(", ")}</p>
              )}
            </div>
            {result.skipped.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1">{result.skipped.length} skipped (recently analyzed):</p>
                <p className="text-xs text-slate-500 font-mono">{result.skipped.join(", ")}</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setResult(null)}
                className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
              >
                Run Again
              </button>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
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
  const [drawerHolding, setDrawerHolding] = useState<PortfolioHolding | null>(null);

  const { data: portfolios = [], isLoading: loadingPortfolios } = useQuery({
    queryKey: ["portfolios"],
    queryFn: listPortfolios,
  });

  const { data: current, isLoading: loadingCurrent } = useQuery({
    queryKey: ["portfolio-current", selectedId],
    queryFn: () => getPortfolioCurrent(selectedId!),
    enabled: selectedId != null,
  });

  const hasHoldings = (current?.holdings?.length ?? 0) > 0;
  const allCrypto = hasHoldings && (current?.holdings ?? []).every((h) => isCrypto(h.ticker));

  // Fetch fundamentals when holdings tab is active.
  // Crypto uses CoinGecko (no key needed); stocks need a Finnhub key.
  const { data: fundamentals } = useQuery({
    queryKey: ["portfolio-fundamentals", selectedId],
    queryFn: () => getPortfolioFundamentals(selectedId!),
    enabled: selectedId != null && tab === "holdings" && (allCrypto || current?.price_unavailable_reason !== "no_finnhub_key"),
    staleTime: 1000 * 60 * 30,
  });

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

  const TABS: Array<{ id: Tab; label: string; badge?: string }> = [
    { id: "holdings", label: "Holdings" },
    { id: "insights", label: "AI Insights", badge: "✦" },
    ...(!allCrypto ? [{ id: "earnings" as Tab, label: "Earnings" }] : []),
    { id: "news", label: "News" },
    { id: "trending", label: "Market", badge: "↑" },
  ];

  return (
    <div className="min-h-screen bg-navy-900">
      <TopNav />
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-lg font-semibold text-white">Portfolio</h1>

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
            onUploadClick={() => setUploadOpen(true)}
            onExportClick={handleExport}
          />
        )}

        <UploadDrawer
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUpload={(file) => uploadMutation.mutate(file)}
          uploading={uploadMutation.isPending}
        />

        {selectedId === null && portfolios.length === 0 && !loadingPortfolios && (
          <p className="text-slate-500 text-sm text-center py-10">
            No portfolios yet. Create one above to get started.
          </p>
        )}

        {selectedId && loadingCurrent && tab !== "trending" && (
          <div className="text-slate-400 text-sm">Loading portfolio…</div>
        )}

        {/* Tab bar — Market tab is always accessible; portfolio tabs require a loaded portfolio */}
        {!loadingPortfolios && (
          <div className="flex gap-1 border-b border-slate-800">
            {selectedId && current && TABS.filter((t) => t.id !== "trending").map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                  tab === t.id
                    ? "border-purple-500 text-white"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>{t.label}</span>
                {t.badge && <span className="text-purple-400 text-xs">{t.badge}</span>}
              </button>
            ))}
            <button
              onClick={() => setTab("trending")}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                tab === "trending"
                  ? "border-purple-500 text-white"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>Market</span>
              <span className="text-purple-400 text-xs">↑</span>
            </button>
          </div>
        )}

        {/* Market panel — available regardless of portfolio selection */}
        {tab === "trending" && <TrendingPanel />}

        {/* Portfolio tab panels — require a loaded portfolio */}
        {selectedId && !loadingCurrent && current && tab !== "trending" && (
          <>
            {tab === "holdings" && (
              <div className="space-y-3">
                {hasHoldings && (
                  <PortfolioStatsBar
                    holdings={current.holdings}
                    onAnalyzeStale={() => setBatchOpen(true)}
                  />
                )}
                <HoldingsTable
                  portfolioId={selectedId}
                  holdings={current.holdings}
                  priceUnavailableReason={current.price_unavailable_reason}
                  displayCurrency={current.display_currency ?? "USD"}
                  fundamentals={fundamentals}
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
      />
    </div>
  );
}
