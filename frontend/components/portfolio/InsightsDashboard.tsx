"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { generateInsight, getLatestInsight, listInsights, getProviderModels } from "@/lib/api";
import { WatchButton } from "@/components/portfolio/WatchButton";
import type { PortfolioInsight, InsightActionItem, InsightRiskAlert } from "@/lib/types";
import { BehavioralAlerts } from "@/components/portfolio/BehavioralAlerts";

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDERS = ["openai", "anthropic", "google", "groq", "ollama", "vllm"] as const;
const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  groq: "Groq",
  ollama: "Ollama",
  vllm: "vLLM",
};
const PROVIDER_PLACEHOLDERS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  google: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3",
  vllm: "mistral-7b",
};

const ACTION_COLORS: Record<string, string> = {
  BUY_MORE: "bg-green-500/20 text-green-300 border-green-500/30",
  TRIM:     "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  EXIT:     "bg-red-500/20 text-red-300 border-red-500/30",
  WATCH:    "bg-blue-500/20 text-blue-300 border-blue-500/30",
  REANALYZE:"bg-purple-500/20 text-purple-300 border-purple-500/30",
};

const PRIORITY_DOT: Record<string, string> = {
  high:   "bg-red-400",
  medium: "bg-yellow-400",
  low:    "bg-slate-500",
};

const SEVERITY_ICON: Record<string, string> = {
  critical: "🔴",
  warning:  "🟡",
  info:     "🔵",
};

const SECTOR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f97316",
  "#eab308", "#22c55e", "#06b6d4", "#3b82f6",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function healthColor(score: number): string {
  if (score >= 8) return "text-green-400";
  if (score >= 5) return "text-yellow-400";
  return "text-red-400";
}

function healthBg(score: number): string {
  if (score >= 8) return "border-green-500/40";
  if (score >= 5) return "border-yellow-500/40";
  return "border-red-500/40";
}

function stanceColor(stance: string): string {
  if (stance === "bullish") return "bg-green-500/20 text-green-300 border-green-500/30";
  if (stance === "bearish") return "bg-red-500/20 text-red-300 border-red-500/30";
  if (stance === "mixed")   return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
  return "bg-slate-700 text-slate-300 border-slate-600";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthScoreRing({ score }: { score: number }) {
  const r = 36;
  const circumference = 2 * Math.PI * r;
  const progress = (score / 10) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 96 96" className="w-24 h-24 -rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
          <circle
            cx="48" cy="48" r={r} fill="none"
            stroke={score >= 8 ? "#4ade80" : score >= 5 ? "#facc15" : "#f87171"}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold tabular-nums ${healthColor(score)}`}>{score}</span>
          <span className="text-slate-500 text-xs leading-none">/ 10</span>
        </div>
      </div>
      <span className="text-slate-500 text-xs">Health Score</span>
    </div>
  );
}

function ActionItemCard({ item }: { item: InsightActionItem }) {
  const router = useRouter();

  return (
    <div className="flex items-start gap-3 bg-slate-800/50 rounded p-3 border border-slate-700/50">
      <div className="flex items-center gap-2 mt-0.5 shrink-0">
        <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[item.priority] ?? "bg-slate-500"}`} />
        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${ACTION_COLORS[item.action] ?? "bg-slate-700 text-slate-300 border-slate-600"}`}>
          {item.action.replace("_", " ")}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <span className="text-slate-200 text-sm font-semibold">{item.ticker}</span>
            <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{item.rationale}</p>
          </div>
          {item.ticker && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => router.push(`/runs/new?ticker=${encodeURIComponent(item.ticker!)}`)}
                className="text-xs font-semibold px-2 py-0.5 rounded bg-violet-700 hover:bg-violet-600 text-white transition-colors"
              >
                ⚡ Analyze
              </button>
              <WatchButton ticker={item.ticker} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RiskAlertCard({ alert }: { alert: InsightRiskAlert }) {
  return (
    <div className="flex items-start gap-2 bg-slate-800/30 rounded p-2.5 border border-slate-700/30">
      <span className="text-base leading-none mt-0.5">{SEVERITY_ICON[alert.severity] ?? "🔵"}</span>
      <div className="flex-1 min-w-0">
        <p className="text-slate-300 text-xs leading-relaxed">{alert.description}</p>
        {alert.affected_tickers?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {alert.affected_tickers.map((t) => (
              <span key={t} className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectorChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-2">
      {entries.map(([sector, pct], i) => (
        <div key={sector} className="flex items-center gap-2">
          <div className="w-24 text-slate-400 text-xs text-right shrink-0 truncate" title={sector}>{sector}</div>
          <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
            <div
              className="h-full rounded transition-all duration-500"
              style={{
                width: `${Math.min(100, pct)}%`,
                backgroundColor: SECTOR_COLORS[i % SECTOR_COLORS.length],
              }}
            />
          </div>
          <div className="w-10 text-slate-400 text-xs tabular-nums text-right shrink-0">
            {typeof pct === "number" ? pct.toFixed(1) : pct}%
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightHistoryRow({ insight, onSelect, selected }: { insight: PortfolioInsight; onSelect: () => void; selected: boolean }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-colors ${
        selected ? "bg-slate-700 border border-slate-600" : "hover:bg-slate-800 border border-transparent"
      }`}
    >
      <div className="shrink-0">
        {insight.health_score != null ? (
          <span className={`text-sm font-bold ${healthColor(insight.health_score)}`}>{insight.health_score}</span>
        ) : (
          <span className="text-slate-600 text-sm">—</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {insight.overall_stance && (
            <span className={`text-xs px-1.5 py-0.5 rounded border ${stanceColor(insight.overall_stance)}`}>
              {insight.overall_stance}
            </span>
          )}
          <span className={`text-xs ${
            insight.status === "running" || insight.status === "pending"
              ? "text-blue-400 animate-pulse"
              : insight.status === "failed"
              ? "text-red-400"
              : "text-slate-500"
          }`}>
            {insight.status === "running" ? "Generating…" : insight.status === "pending" ? "Queued…" : timeAgo(insight.generated_at)}
          </span>
        </div>
      </div>
      <span className="text-xs text-slate-600 shrink-0">
        {insight.trigger === "scheduled" ? "⏰" : "▶"}
      </span>
    </button>
  );
}

// ── Generate Form ─────────────────────────────────────────────────────────────

function GenerateForm({
  portfolioId,
  onGenerated,
}: {
  portfolioId: string;
  onGenerated: (insight: PortfolioInsight) => void;
}) {
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");

  const { data: models = [] } = useQuery({
    queryKey: ["models", provider],
    queryFn: () => getProviderModels(provider),
    retry: false,
  });

  useEffect(() => { setModel(""); }, [provider]);
  useEffect(() => {
    if (["ollama", "vllm"].includes(provider) && models.length > 0 && !model) {
      setModel(models[0]);
    }
  }, [models, provider, model]);

  const mutation = useMutation({
    mutationFn: () =>
      generateInsight(portfolioId, {
        llm_provider: provider,
        llm_model: model || PROVIDER_PLACEHOLDERS[provider],
      }),
    onSuccess: (insight) => onGenerated(insight),
  });

  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 space-y-3">
      <p className="text-slate-400 text-sm">
        Generate a full AI analysis of your portfolio — health score, action items, risk alerts, and sector breakdown.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-slate-400 text-xs mb-1">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-sm focus:outline-none focus:border-blue-600"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-slate-400 text-xs mb-1">Model</label>
          {models.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-sm focus:outline-none focus:border-blue-600"
            >
              <option value="">— select model —</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={PROVIDER_PLACEHOLDERS[provider]}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-sm focus:outline-none focus:border-blue-600 w-48"
            />
          )}
        </div>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="px-4 py-1.5 rounded text-sm font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
        >
          {mutation.isPending ? "Starting…" : "Generate Insights"}
        </button>
      </div>
      {mutation.isError && (
        <p className="text-red-400 text-xs">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

// ── PDF export helper ─────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Main Insight View ─────────────────────────────────────────────────────────

function InsightView({ insight, portfolioName }: { insight: PortfolioInsight; portfolioName?: string }) {
  const [pdfLoading, setPdfLoading] = useState(false);

  async function handleExportPdf() {
    setPdfLoading(true);
    try {
      const [{ pdf }, { InsightDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/export/InsightPdf"),
      ]);
      const blob = await pdf(
        <InsightDocument insight={insight} portfolioName={portfolioName} />
      ).toBlob();
      const date = new Date(insight.generated_at).toISOString().slice(0, 10);
      triggerDownload(blob, `${portfolioName ?? "portfolio"}-insights-${date}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setPdfLoading(false);
    }
  }

  if (insight.status === "pending" || insight.status === "running") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <div>
          <p className="text-slate-300 text-sm font-medium">
            {insight.status === "pending" ? "Queued for analysis…" : "Generating insights…"}
          </p>
          <p className="text-slate-500 text-xs mt-1">
            Using {insight.llm_provider} / {insight.llm_model} · typically 15–45 seconds
          </p>
        </div>
      </div>
    );
  }

  if (insight.status === "failed") {
    return (
      <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4 text-red-300 text-sm">
        <p className="font-medium mb-1">Insight generation failed</p>
        <p className="text-xs text-red-400">{insight.error ?? "Unknown error"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header: score + stance + summary */}
      <div className={`bg-slate-800/40 border rounded-lg p-4 flex items-start gap-6 ${healthBg(insight.health_score ?? 5)}`}>
        <HealthScoreRing score={insight.health_score ?? 0} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {insight.overall_stance && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${stanceColor(insight.overall_stance)}`}>
                {insight.overall_stance}
              </span>
            )}
            <span className="text-slate-600 text-xs">{fmtDate(insight.generated_at)}</span>
            <span className="text-slate-600 text-xs">·</span>
            <span className="text-slate-600 text-xs capitalize">{insight.trigger}</span>
            <div className="flex-1" />
            <button
              onClick={handleExportPdf}
              disabled={pdfLoading}
              className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded px-2.5 py-1 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
            >
              {pdfLoading ? (
                <>
                  <span className="inline-block w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
                    <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
                  </svg>
                  Export PDF
                </>
              )}
            </button>
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">{insight.summary}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Action Items */}
        {insight.action_items && insight.action_items.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Action Items
            </h3>
            <div className="space-y-2">
              {insight.action_items.map((item, i) => (
                <ActionItemCard key={i} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* Risk Alerts */}
        {insight.risk_alerts && insight.risk_alerts.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Risk Alerts
            </h3>
            <div className="space-y-2">
              {insight.risk_alerts.map((alert, i) => (
                <RiskAlertCard key={i} alert={alert} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sector Analysis */}
      {insight.sector_analysis && Object.keys(insight.sector_analysis).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
            Sector Exposure
          </h3>
          <div className="bg-slate-800/30 rounded-lg p-4">
            <SectorChart data={insight.sector_analysis} />
          </div>
        </div>
      )}

      {/* Strengths & Weaknesses */}
      {((insight.strengths?.length ?? 0) > 0 || (insight.weaknesses?.length ?? 0) > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {insight.strengths && insight.strengths.length > 0 && (
            <div className="bg-green-900/10 border border-green-800/30 rounded-lg p-3 space-y-1">
              <h3 className="text-green-400 text-xs font-semibold uppercase tracking-wider mb-2">Strengths</h3>
              {insight.strengths.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-green-500 text-xs mt-0.5">✓</span>
                  <p className="text-slate-300 text-xs leading-relaxed">{s}</p>
                </div>
              ))}
            </div>
          )}
          {insight.weaknesses && insight.weaknesses.length > 0 && (
            <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-3 space-y-1">
              <h3 className="text-red-400 text-xs font-semibold uppercase tracking-wider mb-2">Weaknesses</h3>
              {insight.weaknesses.map((w, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-red-500 text-xs mt-0.5">!</span>
                  <p className="text-slate-300 text-xs leading-relaxed">{w}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── InsightsDashboard (main export) ──────────────────────────────────────────

interface InsightsDashboardProps {
  portfolioId: string;
  hasHoldings: boolean;
  portfolioName?: string;
}

export function InsightsDashboard({ portfolioId, hasHoldings, portfolioName }: InsightsDashboardProps) {
  const qc = useQueryClient();
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const { data: latest } = useQuery({
    queryKey: ["insight-latest", portfolioId],
    queryFn: () => getLatestInsight(portfolioId),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d && (d.status === "pending" || d.status === "running")) return 2000;
      return false;
    },
    enabled: !!portfolioId,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["insights-list", portfolioId],
    queryFn: () => listInsights(portfolioId, 10),
    enabled: !!portfolioId,
  });

  // Auto-select latest insight when list loads
  useEffect(() => {
    if (!selectedInsightId && history.length > 0) {
      setSelectedInsightId(history[0].id);
    }
  }, [history, selectedInsightId]);

  // Keep latest in sync with history list
  useEffect(() => {
    if (latest) {
      qc.setQueryData(["insights-list", portfolioId], (old: PortfolioInsight[] | undefined) => {
        if (!old) return [latest];
        const idx = old.findIndex((i) => i.id === latest.id);
        if (idx === -1) {
          setSelectedInsightId(latest.id);
          return [latest, ...old];
        }
        const updated = [...old];
        updated[idx] = latest;
        return updated;
      });
    }
  }, [latest, portfolioId, qc]);

  const selectedInsight = history.find((i) => i.id === selectedInsightId) ?? latest ?? null;
  const isRunning = latest?.status === "pending" || latest?.status === "running";

  function handleGenerated(insight: PortfolioInsight) {
    setSelectedInsightId(insight.id);
    setShowGenerate(false);
    qc.invalidateQueries({ queryKey: ["insight-latest", portfolioId] });
    qc.invalidateQueries({ queryKey: ["insights-list", portfolioId] });
  }

  if (!hasHoldings) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm">
        Upload a portfolio CSV to enable AI insights.
      </div>
    );
  }

  return (
    <div>
      <BehavioralAlerts portfolioId={portfolioId} />
      <div className="flex gap-5">
      {/* Sidebar: history + generate button */}
      <div className="w-52 shrink-0 space-y-2">
        <button
          onClick={() => setShowGenerate((v) => !v)}
          disabled={isRunning}
          className="w-full px-3 py-2 rounded text-sm font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2"
        >
          {isRunning ? (
            <>
              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating…
            </>
          ) : (
            <>✦ Generate Insights</>
          )}
        </button>

        {history.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-slate-600 text-xs px-1 py-1">History</p>
            {history.map((insight) => (
              <InsightHistoryRow
                key={insight.id}
                insight={insight}
                selected={insight.id === selectedInsightId}
                onSelect={() => setSelectedInsightId(insight.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-4">
        {showGenerate && (
          <GenerateForm portfolioId={portfolioId} onGenerated={handleGenerated} />
        )}

        {!showGenerate && !selectedInsight && (
          <div className="text-center py-16 text-slate-500 text-sm">
            No insights yet.{" "}
            <button
              onClick={() => setShowGenerate(true)}
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              Generate your first insight →
            </button>
          </div>
        )}

        {selectedInsight && !showGenerate && (
          <InsightView insight={selectedInsight} portfolioName={portfolioName} />
        )}
      </div>

      </div>
    </div>
  );
}
