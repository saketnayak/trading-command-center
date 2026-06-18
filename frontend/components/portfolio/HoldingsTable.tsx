"use client";
import React, { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { addHolding, updateHolding, deleteHolding, getLatestRunsByTicker, type LatestRunEntry } from "@/lib/api";
import { fmtMoney, fmtPnl } from "@/lib/currency";
import { WatchButton } from "@/components/portfolio/WatchButton";
import { IconButton, IconLink } from "@/components/ui/IconButton";
import { TickerLabel } from "@/components/ui/TickerLabel";
import { useTickerMetadata } from "@/lib/useTickerMetadata";
import { WaveBadge } from "@/components/wave/WaveBadge";
import type { PortfolioHolding, FundamentalsData, RegimeData, WaveSummary, TrimSignalEntry, FinnhubUnavailableReason } from "@/lib/types";
import { finnhubUnavailableMessage } from "@/lib/finnhubMessages";

interface HoldingsTableProps {
  portfolioId: string;
  holdings: PortfolioHolding[];
  priceUnavailableReason: string | null;
  fundamentalsUnavailableReason?: FinnhubUnavailableReason | null;
  displayCurrency: string;
  fundamentals?: Record<string, FundamentalsData>;
  regime?: Record<string, RegimeData>;
  wave?: Record<string, WaveSummary>;
  trimSignals?: Record<string, TrimSignalEntry>;
  onTickerClick?: (holding: PortfolioHolding) => void;
}

interface DraftRow {
  ticker: string;
  shares: string;
  avg_cost: string;
}

type SortKey = "ticker" | "shares" | "avg_cost" | "current_price" | "market_value" | "unrealized_pnl";
type SortDir = "asc" | "desc";

function SortableHeader({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  align = "right",
  className = "",
}: {
  label: string;
  colKey: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortKey === colKey;
  const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th
      className={`px-3 py-3 text-${align} cursor-pointer select-none group whitespace-nowrap ${className}`}
      onClick={() => onSort(colKey)}
    >
      <span className={active ? "text-blue-400" : "group-hover:text-fg transition-colors"}>
        {label}
        {active ? (
          <span className="text-blue-400">{arrow}</span>
        ) : (
          <span className="text-subtle group-hover:text-muted ml-0.5">↕</span>
        )}
      </span>
    </th>
  );
}

function fmtNum(n: number | null, decimals = 2, suffix = ""): string {
  if (n == null) return "—";
  return `${n.toFixed(decimals)}${suffix}`;
}

function fmtLargeNum(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}


function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function EditInput({
  value,
  onChange,
  className,
  onKeyDown,
  autoFocus,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={`bg-input border border-input-border rounded-sm px-2 py-1 text-xs text-fg focus:outline-hidden focus:border-blue-500 ${className ?? ""}`}
    />
  );
}

function FundamentalsRow({ data, colSpan }: { data: FundamentalsData; colSpan: number }) {
  const metrics: Array<{ label: string; value: string; color?: string }> = data.asset_type === "crypto"
    ? [
        { label: "Mkt Cap", value: fmtLargeNum(data.market_cap ?? null) },
        { label: "Vol 24h", value: fmtLargeNum(data.volume_24h ?? null) },
        { label: "Circ Supply", value: data.circulating_supply != null ? `${(data.circulating_supply / 1e6).toFixed(2)}M` : "—" },
        { label: "ATH", value: data.all_time_high != null ? `$${data.all_time_high.toLocaleString()}` : "—" },
        { label: "24h %", value: fmtNum(data.price_change_24h_pct ?? null, 2, "%") },
        { label: "7d %", value: fmtNum(data.price_change_7d_pct ?? null, 2, "%") },
        { label: "Category", value: data.category ?? "—" },
      ]
    : [
        { label: "P/E", value: fmtNum(data.pe_ratio ?? null) },
        {
          label: "PEG",
          value: fmtNum(data.peg_ratio ?? null),
          color: data.peg_ratio != null ? pegSignal(data.peg_ratio).textColor : undefined,
        },
        { label: "EPS Gr 3Y", value: fmtNum(data.eps_growth_3y ?? null, 1, "%") },
        { label: "Beta", value: fmtNum(data.beta ?? null) },
        { label: "52w High", value: data.week52_high != null ? `$${data.week52_high.toFixed(2)}` : "—" },
        { label: "52w Low", value: data.week52_low != null ? `$${data.week52_low.toFixed(2)}` : "—" },
        { label: "Div Yield", value: fmtNum(data.dividend_yield ?? null, 2, "%") },
        { label: "EPS (TTM)", value: data.eps_ttm != null ? `$${data.eps_ttm.toFixed(2)}` : "—" },
        { label: "Mkt Cap", value: fmtLargeNum(data.market_cap ?? null) },
      ];

  return (
    <tr className="border-t border-input-border/50 bg-input/20">
      <td colSpan={colSpan} className="px-6 py-2">
        <div className="flex flex-wrap gap-4">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted uppercase tracking-wide">{m.label}</span>
              <span className={`text-xs font-mono ${m.color ?? "text-fg-secondary"}`}>{m.value}</span>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

function pegSignal(peg: number): { textColor: string; bgColor: string; label: string } {
  if (peg < 1.0) return { textColor: "text-green-400", bgColor: "bg-green-900/30", label: "Undervalued" };
  if (peg <= 1.5) return { textColor: "text-yellow-400", bgColor: "bg-yellow-900/30", label: "Fairly valued" };
  return { textColor: "text-red-400", bgColor: "bg-red-900/30", label: "Overvalued" };
}

function PegBadge({ peg }: { peg: number | null | undefined }) {
  if (peg != null) {
    const { textColor, bgColor, label } = pegSignal(peg);
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${textColor} ${bgColor}`}
        title={`PEG ${peg.toFixed(2)} — ${label} relative to growth`}
      >
        PEG {peg.toFixed(2)}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-muted bg-input"
      title="PEG unavailable — negative earnings or no 3-year growth data from Finnhub"
    >
      PEG N/A
    </span>
  );
}

function regimeColors(regime: "Bull" | "Sideways" | "Bear"): { text: string; bg: string } {
  if (regime === "Bull") return { text: "text-green-400", bg: "bg-green-900/30" };
  if (regime === "Bear") return { text: "text-red-400", bg: "bg-red-900/30" };
  return { text: "text-yellow-400", bg: "bg-yellow-900/30" };
}

function TrimBadge({ entry }: { entry?: TrimSignalEntry }) {
  if (!entry || entry.level === "none") return null;
  const styles: Record<string, { label: string; cls: string }> = {
    watch: { label: "● Watch", cls: "text-yellow-400 bg-yellow-900/30" },
    consider_trim: { label: "● Trim", cls: "text-orange-400 bg-orange-900/30" },
    strong_trim: { label: "● Strong Trim", cls: "text-red-400 bg-red-900/30" },
  };
  const s = styles[entry.level];
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${s.cls}`}
      title={entry.reasons.join("\n")}
    >
      {s.label}
    </span>
  );
}

function RegimeBadge({ data }: { data: RegimeData | undefined | null }) {
  if (!data) return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-muted bg-input">
      ● —
    </span>
  );
  const { text, bg } = regimeColors(data.current_regime);
  const signStr = data.signal >= 0 ? `+${data.signal.toFixed(2)}` : data.signal.toFixed(2);
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${text} ${bg}`}
      title={`Markov regime: ${data.current_regime} (${(data.persistence * 100).toFixed(0)}% persistence). Signal: ${signStr} (bull_prob − bear_prob). Powered by yfinance 10y daily data.`}
    >
      ● {data.current_regime} {signStr}
    </span>
  );
}

function RegimeRow({ data, colSpan }: { data: RegimeData; colSpan: number }) {
  const [showMatrix, setShowMatrix] = useState(false);
  const { text } = regimeColors(data.current_regime);
  const signStr = data.signal >= 0 ? `+${data.signal.toFixed(2)}` : data.signal.toFixed(2);
  const sharpeColor = data.walk_forward.sharpe == null ? "text-muted"
    : data.walk_forward.sharpe > 0.5 ? "text-green-400"
    : data.walk_forward.sharpe > 0 ? "text-yellow-400" : "text-red-400";
  const ddColor = (data.walk_forward.max_drawdown ?? 0) < -0.2 ? "text-red-400"
    : (data.walk_forward.max_drawdown ?? 0) < -0.1 ? "text-yellow-400" : "text-fg-secondary";
  const signalColor = data.signal >= 0.3 ? "text-green-400" : data.signal <= -0.3 ? "text-red-400" : "text-yellow-400";

  const statBars: Array<{ label: string; value: number; color: string }> = [
    { label: "Bull", value: data.stationary.bull, color: "bg-green-500" },
    { label: "Sidew.", value: data.stationary.sideways, color: "bg-yellow-500" },
    { label: "Bear", value: data.stationary.bear, color: "bg-red-500" },
  ];

  return (
    <tr className="border-t border-input-border/30 bg-page/30">
      <td colSpan={colSpan} className="px-6 py-2">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-4 text-xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted uppercase tracking-wide">Regime</span>
              <span className={`font-mono font-semibold ${text}`}>{data.current_regime}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted uppercase tracking-wide">Signal</span>
              <span className={`font-mono ${signalColor}`}>{signStr}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted uppercase tracking-wide">Persistence</span>
              <span className="font-mono text-fg-secondary">{(data.persistence * 100).toFixed(0)}%</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted uppercase tracking-wide">Sharpe (WF)</span>
              <span className={`font-mono ${sharpeColor}`}>
                {data.walk_forward.sharpe != null ? data.walk_forward.sharpe.toFixed(2) : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted uppercase tracking-wide">Max DD</span>
              <span className={`font-mono ${ddColor}`}>
                {data.walk_forward.max_drawdown != null
                  ? `${(data.walk_forward.max_drawdown * 100).toFixed(1)}%`
                  : "—"}
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted uppercase tracking-wide" title="Long-run % of time this asset spends in each regime (Markov stationary distribution).">Long-run distribution</span>
            <div className="space-y-0.5">
              {statBars.map((b) => (
                <div key={b.label} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted w-10">{b.label}</span>
                  <div className="flex-1 bg-muted-surface rounded h-1.5">
                    <div
                      className={`h-1.5 rounded ${b.color}`}
                      style={{ width: `${(b.value * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-fg-secondary w-8 text-right">
                    {(b.value * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <button
              onClick={() => setShowMatrix((v) => !v)}
              className="text-[10px] text-muted hover:text-fg-secondary underline underline-offset-2"
            >
              {showMatrix ? "Hide matrix" : "Show matrix"}
            </button>
            {showMatrix && (() => {
              const labels = ["Bear", "Sidew.", "Bull"];
              function matrixCellColor(v: number): string {
                if (v >= 0.7) return "text-green-300 bg-green-900/40";
                if (v >= 0.5) return "text-green-400 bg-green-900/20";
                if (v >= 0.3) return "text-yellow-400 bg-yellow-900/20";
                return "text-muted";
              }
              return (
                <table className="mt-1 text-[10px] font-mono border-collapse">
                  <thead>
                    <tr>
                      <th className="text-subtle pr-2" />
                      {labels.map((l) => <th key={l} className="px-2 py-0.5 text-muted text-center">{l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.transition_matrix.map((row, i) => (
                      <tr key={i}>
                        <td className="pr-2 text-muted">{labels[i]}</td>
                        {row.map((v, j) => (
                          <td key={j} className={`px-2 py-0.5 text-center rounded ${matrixCellColor(v)}`}>
                            {(v * 100).toFixed(0)}%
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
      </td>
    </tr>
  );
}

export function HoldingsTable({ portfolioId, holdings, priceUnavailableReason, fundamentalsUnavailableReason, displayCurrency, fundamentals, regime, wave, trimSignals, onTickerClick }: HoldingsTableProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow>({ ticker: "", shares: "", avg_cost: "" });
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<DraftRow>({ ticker: "", shares: "", avg_cost: "" });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterTicker, setFilterTicker] = useState("");
  const [filterSignal, setFilterSignal] = useState("");
  const [filterPeg, setFilterPeg] = useState("");
  const [filterRegime, setFilterRegime] = useState("");
  const [trimOnly, setTrimOnly] = useState(false);
  const newTickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!trimSignals) setTrimOnly(false);
  }, [trimSignals]);

  useEffect(() => {
    if (!regime || Object.keys(regime).length === 0) setFilterRegime("");
  }, [regime]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey(null); setSortDir("asc"); }
    } else {
      setSortKey(key);
      setSortDir(key === "ticker" ? "asc" : "desc");
    }
  }

  const tickers = holdings.map((h) => h.ticker);
  const { data: tickerMetadata = {} } = useTickerMetadata(tickers);
  const { data: latestRuns = {} } = useQuery({
    queryKey: ["latest-runs-by-ticker", tickers],
    queryFn: () => getLatestRunsByTicker(tickers),
    enabled: tickers.length > 0,
    staleTime: 60_000,
  });

  const isFiltered = filterTicker !== "" || filterSignal !== "" || filterPeg !== "" || filterRegime !== "" || trimOnly;

  const filteredHoldings = useMemo(() => {
    let result = holdings;
    if (filterTicker) {
      const q = filterTicker.toUpperCase();
      result = result.filter((h) => h.ticker.toUpperCase().includes(q));
    }
    if (filterSignal === "none") {
      result = result.filter((h) => !latestRuns[h.ticker]);
    } else if (filterSignal) {
      result = result.filter((h) => latestRuns[h.ticker]?.verdict?.toLowerCase() === filterSignal);
    }
    if (filterPeg === "undervalued") {
      result = result.filter((h) => { const p = fundamentals?.[h.ticker]?.peg_ratio; return p != null && p < 1; });
    } else if (filterPeg === "fair") {
      result = result.filter((h) => { const p = fundamentals?.[h.ticker]?.peg_ratio; return p != null && p >= 1 && p <= 2; });
    } else if (filterPeg === "overvalued") {
      result = result.filter((h) => { const p = fundamentals?.[h.ticker]?.peg_ratio; return p != null && p > 2; });
    } else if (filterPeg === "nodata") {
      result = result.filter((h) => fundamentals?.[h.ticker]?.peg_ratio == null);
    }
    if (filterRegime === "nodata") {
      result = result.filter((h) => !regime?.[h.ticker]);
    } else if (filterRegime) {
      result = result.filter((h) => regime?.[h.ticker]?.current_regime === filterRegime);
    }
    if (trimOnly) {
      result = result.filter((h) => {
        const lvl = trimSignals?.[h.id]?.level;
        return lvl && lvl !== "none";
      });
    }
    return result;
  }, [holdings, filterTicker, filterSignal, filterPeg, filterRegime, trimOnly, latestRuns, fundamentals, regime, trimSignals]);

  const sortedHoldings = useMemo(() => {
    if (!sortKey) return filteredHoldings;
    return [...filteredHoldings].sort((a, b) => {
      let av: number | string | null;
      let bv: number | string | null;
      if (sortKey === "ticker") { av = a.ticker; bv = b.ticker; }
      else { av = a[sortKey] as number | null; bv = b[sortKey] as number | null; }

      // nulls always last
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredHoldings, sortKey, sortDir]);

  useEffect(() => {
    if (addingNew) newTickerRef.current?.focus();
  }, [addingNew]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["portfolio-current", portfolioId] });
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: DraftRow }) =>
      updateHolding(portfolioId, id, {
        ticker: draft.ticker.trim().toUpperCase(),
        shares: parseFloat(draft.shares),
        avg_cost: draft.avg_cost.trim() ? parseFloat(draft.avg_cost) : null,
      }),
    onSuccess: () => { setEditingId(null); refresh(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteHolding(portfolioId, id),
    onSuccess: () => refresh(),
  });

  const addMutation = useMutation({
    mutationFn: (draft: DraftRow) =>
      addHolding(portfolioId, {
        ticker: draft.ticker.trim().toUpperCase(),
        shares: parseFloat(draft.shares),
        avg_cost: draft.avg_cost.trim() ? parseFloat(draft.avg_cost) : null,
      }),
    onSuccess: () => { setAddingNew(false); setNewDraft({ ticker: "", shares: "", avg_cost: "" }); refresh(); },
  });

  function startEdit(h: PortfolioHolding) {
    setEditingId(h.id);
    setEditDraft({ ticker: h.ticker, shares: String(h.shares), avg_cost: h.avg_cost != null ? String(h.avg_cost) : "" });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function saveEdit() {
    if (!editingId) return;
    if (!editDraft.ticker.trim() || !editDraft.shares.trim() || isNaN(parseFloat(editDraft.shares))) return;
    updateMutation.mutate({ id: editingId, draft: editDraft });
  }

  function saveNew() {
    if (!newDraft.ticker.trim() || !newDraft.shares.trim() || isNaN(parseFloat(newDraft.shares))) return;
    addMutation.mutate(newDraft);
  }

  function handleEditKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") cancelEdit();
  }

  function handleNewKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") saveNew();
    if (e.key === "Escape") { setAddingNew(false); setNewDraft({ ticker: "", shares: "", avg_cost: "" }); }
  }

  const hasFundamentals = fundamentals && Object.keys(fundamentals).length > 0;
  const hasRegime = regime && Object.keys(regime).length > 0;
  const hasTrimSignals = trimSignals != null;
  const colSpan = 7 + (hasRegime ? 1 : 0) + (hasTrimSignals ? 1 : 0);

  const fundamentalsMessage = finnhubUnavailableMessage(fundamentalsUnavailableReason, "fundamentals");

  return (
    <div className="space-y-3">
      {priceUnavailableReason === "no_finnhub_key" && (
        <div className="text-xs text-amber-400/80 bg-amber-900/20 border border-amber-700/40 rounded-sm px-3 py-2">
          Showing delayed prices via Yahoo Finance — add your Finnhub API key in{" "}
          <Link href="/settings" className="text-blue-400 hover:underline">Settings</Link>{" "}
          for real-time data.
        </div>
      )}
      {fundamentalsMessage && (
        <div className="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-700/40 rounded-sm px-3 py-2">
          {fundamentalsMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* Ticker search */}
        <input
          type="text"
          value={filterTicker}
          onChange={(e) => setFilterTicker(e.target.value)}
          placeholder="Filter by ticker…"
          className="bg-input border border-input-border rounded-sm px-3 py-1.5 text-xs text-fg w-40 focus:outline-hidden focus:border-blue-500 placeholder-slate-500"
        />

        {/* Signal filter */}
        <select
          value={filterSignal}
          onChange={(e) => setFilterSignal(e.target.value)}
          className="bg-input border border-input-border rounded-sm px-3 py-1.5 text-xs text-fg focus:outline-hidden focus:border-blue-500"
        >
          <option value="">All signals</option>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
          <option value="hold">Hold</option>
          <option value="none">Not analyzed</option>
        </select>

        {/* PEG filter */}
        {hasFundamentals && (
          <select
            value={filterPeg}
            onChange={(e) => setFilterPeg(e.target.value)}
            className="bg-input/80 border border-input-border rounded-lg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-blue-500/60 cursor-pointer transition-colors"
          >
            <option value="">All PEG</option>
            <option value="undervalued">Undervalued (&lt; 1)</option>
            <option value="fair">Fair (1–2)</option>
            <option value="overvalued">Overvalued (&gt; 2)</option>
            <option value="nodata">No PEG data</option>
          </select>
        )}

        {/* Regime filter — pill toggles */}
        {hasRegime && (
          <div className="flex items-center rounded-lg border border-input-border bg-input/80 p-0.5 gap-0.5">
            {(["", "Bull", "Sideways", "Bear"] as const).map((val) => {
              const isActive = filterRegime === val;
              const label = val === "" ? "All" : val === "Sideways" ? "Sidew." : val;
              const activeClass =
                val === "Bull" ? "bg-green-800/80 text-green-100" :
                val === "Bear" ? "bg-red-900/80 text-red-100" :
                val === "Sideways" ? "bg-yellow-800/80 text-yellow-100" :
                "bg-muted-surface text-fg";
              const idleClass =
                val === "Bull" ? "text-green-500 hover:text-green-300" :
                val === "Bear" ? "text-red-500 hover:text-red-300" :
                val === "Sideways" ? "text-yellow-500 hover:text-yellow-300" :
                "text-muted hover:text-fg";
              return (
                <button
                  key={val}
                  onClick={() => setFilterRegime(val)}
                  className={`text-[11px] font-medium px-2.5 py-0.5 rounded-md transition-colors ${isActive ? activeClass : idleClass}`}
                >
                  {val ? `● ${label}` : label}
                </button>
              );
            })}
          </div>
        )}

        {hasTrimSignals && (
          <button
            type="button"
            onClick={() => setTrimOnly((v) => !v)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              trimOnly
                ? "bg-orange-500/20 text-orange-300 border-orange-500/50"
                : "bg-transparent text-muted border-input-border hover:border-border-strong"
            }`}
          >
            Trim signals only
          </button>
        )}

        {isFiltered && (
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-xs text-muted tabular-nums">
              {filteredHoldings.length} / {holdings.length}
            </span>
            <button
              onClick={() => { setFilterTicker(""); setFilterSignal(""); setFilterPeg(""); setFilterRegime(""); setTrimOnly(false); }}
              className="text-[11px] text-muted hover:text-fg border border-input-border hover:border-border-strong rounded px-1.5 py-0.5 transition-colors"
            >
              ✕ Clear
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-muted text-xs uppercase tracking-wider">
            <tr>
              <SortableHeader label="Ticker"         colKey="ticker"         sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
              <SortableHeader label="Position"       colKey="shares"         sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Current Price"  colKey="current_price"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
              <SortableHeader label="Market Value"   colKey="market_value"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
              <SortableHeader label="Unrealized P&L" colKey="unrealized_pnl" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className="text-left px-3 py-3 whitespace-nowrap text-muted text-xs uppercase tracking-wider">Last Analysis</th>
              {hasRegime && (
                <th className="hidden lg:table-cell text-left px-3 py-3 whitespace-nowrap text-muted text-xs uppercase tracking-wider">AI vs Regime</th>
              )}
              {hasTrimSignals && (
                <th className="hidden lg:table-cell text-left px-3 py-3 whitespace-nowrap text-muted text-xs uppercase tracking-wider">Trim</th>
              )}
              <th className="text-left px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedHoldings.length === 0 && !addingNew ? (
              <tr>
                <td colSpan={colSpan} className="text-center text-muted px-4 py-8">
                  {isFiltered ? "No holdings match the current filters." : "No holdings. Add a row below or upload a CSV."}
                </td>
              </tr>
            ) : (
              sortedHoldings.map((h) => {
                const isEditing = editingId === h.id;
                const isExpanded = expandedIds.has(h.id);
                const fundData = fundamentals?.[h.ticker] ?? null;
                const pnl = h.unrealized_pnl;
                const pnlColor = pnl == null ? "text-muted" : pnl >= 0 ? "text-green-400" : "text-red-400";
                const rowEntry = latestRuns[h.ticker] ?? null;
                const rowTint = rowEntry != null && daysAgo(rowEntry.completed_at) <= 14
                  ? rowEntry.verdict === "buy" ? "bg-emerald-900/20"
                  : rowEntry.verdict === "sell" ? "bg-red-900/20"
                  : ""
                  : "";
                const tickerMeta = tickerMetadata[h.ticker.toUpperCase()];

                return (
                  <React.Fragment key={h.id}>
                    <tr className={`border-t border-border hover:bg-input/30 ${rowTint}`}>
                      {/* Ticker + badges (stacked) + expand toggle */}
                      <td className="px-3 py-2 align-top">
                        {isEditing ? (
                          <EditInput
                            autoFocus
                            value={editDraft.ticker}
                            onChange={(v) => setEditDraft((d) => ({ ...d, ticker: v }))}
                            onKeyDown={handleEditKey}
                            className="w-24 uppercase"
                          />
                        ) : (
                          <div className="flex min-w-[160px] items-start gap-1.5">
                            {(hasFundamentals || hasRegime) && (fundData || regime?.[h.ticker]) ? (
                              <button
                                onClick={() => toggleExpand(h.id)}
                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[11px] transition-colors ${isExpanded ? "text-blue-400 bg-blue-900/30" : "text-muted hover:text-fg hover:bg-muted-surface"}`}
                                title={isExpanded ? "Collapse details" : "Expand for fundamentals & regime analysis"}
                              >
                                {isExpanded ? "▾" : "▸"}
                              </button>
                            ) : <span className="mt-0.5 h-4 w-4 shrink-0" />}
                            <div className="flex min-w-0 flex-col gap-1">
                              <TickerLabel
                                ticker={h.ticker}
                                metadata={tickerMeta}
                                onClick={onTickerClick ? () => onTickerClick(h) : undefined}
                                href={
                                  !onTickerClick && h.last_run
                                    ? `/runs/${h.last_run.run_id}`
                                    : undefined
                                }
                              />
                              <div className="flex min-w-0 flex-wrap items-center gap-1">
                                {fundData && fundData.asset_type === "stock" && (
                                  <PegBadge peg={fundData.peg_ratio} />
                                )}
                                {regime?.[h.ticker] && <RegimeBadge data={regime[h.ticker]} />}
                                {wave?.[h.ticker.toUpperCase()] && (
                                  <WaveBadge data={wave[h.ticker.toUpperCase()]} />
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Position: shares + avg cost stacked */}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {isEditing ? (
                          <div className="flex flex-col gap-1 items-end">
                            <EditInput
                              value={editDraft.shares}
                              onChange={(v) => { if (v === "" || /^\d*\.?\d*$/.test(v)) setEditDraft((d) => ({ ...d, shares: v })); }}
                              onKeyDown={handleEditKey}
                              className="w-24 text-right"
                            />
                            <EditInput
                              value={editDraft.avg_cost}
                              onChange={(v) => { if (v === "" || /^\d*\.?\d*$/.test(v)) setEditDraft((d) => ({ ...d, avg_cost: v })); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && editDraft.avg_cost.trim() === ".") return;
                                handleEditKey(e);
                              }}
                              placeholder="avg cost"
                              className="w-24 text-right"
                            />
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-fg-secondary font-mono text-xs">{h.shares.toLocaleString("en-US")} sh</span>
                            <span className="text-muted font-mono text-[10px]">@ {fmtMoney(h.avg_cost, displayCurrency)}</span>
                          </div>
                        )}
                      </td>

                      {/* Current Price (read-only) */}
                      <td className="hidden lg:table-cell px-3 py-2 text-right text-fg-secondary tabular-nums font-mono text-xs">{fmtMoney(h.current_price, displayCurrency)}</td>

                      {/* Market Value (read-only) */}
                      <td className="hidden lg:table-cell px-3 py-2 text-right text-fg-secondary tabular-nums font-mono text-xs">{fmtMoney(h.market_value, displayCurrency)}</td>

                      {/* Unrealized P&L (read-only) */}
                      <td className={`px-3 py-2 text-right tabular-nums ${pnlColor}`}>
                        <div className="font-semibold font-mono text-xs">{fmtPnl(pnl, h.unrealized_pnl_pct, displayCurrency)}</div>
                      </td>

                      {/* Last Analysis */}
                      <td className="px-3 py-2 text-right">
                        {(() => {
                          const entry: LatestRunEntry | null | undefined = latestRuns[h.ticker];
                          if (!entry) {
                            return <span className="text-xs text-subtle italic">Never analyzed</span>;
                          }
                          const days = daysAgo(entry.completed_at);
                          const stale = days > 14;
                          const verdictColors: Record<string, string> = {
                            buy: "bg-emerald-700 text-emerald-100",
                            sell: "bg-red-700 text-red-100",
                            hold: "bg-amber-700 text-amber-100",
                          };
                          return (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${verdictColors[entry.verdict] ?? "bg-muted-surface text-fg"}`}>
                                {entry.verdict.toUpperCase()}
                              </span>
                              {h.last_run?.previous_verdict && h.last_run?.previous_run_id && (
                                <a
                                  href={`/runs/compare?a=${h.last_run?.previous_run_id}&b=${h.last_run?.run_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-1 text-amber-400 hover:text-amber-300"
                                  title={`Verdict changed from ${h.last_run?.previous_verdict} on ${h.last_run?.previous_analysis_date} → ${h.last_run?.verdict} on ${h.last_run?.analysis_date}. Click to compare.`}
                                >
                                  ↺ changed
                                </a>
                              )}
                              <span className={`text-xs ${stale ? "text-amber-400" : "text-muted"}`}>
                                {days === 0 ? "today" : `${days}d ago`}{stale ? " ⚠" : ""}
                              </span>
                              <Link
                                href={`/runs/${entry.run_id}`}
                                className="text-xs text-blue-400 hover:text-blue-300"
                                title="View run"
                              >
                                ↗
                              </Link>
                            </div>
                          );
                        })()}
                      </td>

                      {/* AI vs Regime */}
                      {hasRegime && (() => {
                        const r = regime?.[h.ticker];
                        const verdict = rowEntry?.verdict;
                        if (!r || !verdict) return <td className="hidden lg:table-cell px-3 py-2 text-muted text-xs">—</td>;
                        const isConflict =
                          (verdict === "buy" && r.signal < 0) ||
                          (verdict === "sell" && r.signal > 0);
                        const isNeutral = verdict === "hold" || r.current_regime === "Sideways";
                        const signStr = `${r.signal >= 0 ? "+" : ""}${r.signal.toFixed(2)}`;
                        return (
                          <td className="hidden lg:table-cell px-3 py-2 text-xs whitespace-nowrap">
                            {isConflict ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-900/30 text-amber-400 border border-amber-500/30"
                                title={`AI verdict (${verdict}) conflicts with Markov regime (${r.current_regime}, signal ${signStr}). Consider reviewing.`}
                              >
                                ⚠ Conflicts
                              </span>
                            ) : isNeutral ? (
                              <span className="text-subtle text-[11px]">— Neutral</span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-900/30 text-green-400 border border-green-500/30"
                                title={`AI verdict (${verdict}) aligns with Markov regime (${r.current_regime}).`}
                              >
                                ✓ Agrees
                              </span>
                            )}
                          </td>
                        );
                      })()}

                      {/* Trim */}
                      {hasTrimSignals && (
                        <td className="hidden lg:table-cell px-3 py-2">
                          <TrimBadge entry={trimSignals?.[h.id]} />
                        </td>
                      )}

                      {/* Actions */}
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <IconButton
                              icon={updateMutation.isPending ? LoaderCircle : Check}
                              label={`Save ${h.ticker} holding`}
                              title="Save"
                              tone="success"
                              onClick={saveEdit}
                              disabled={updateMutation.isPending}
                              iconClassName={updateMutation.isPending ? "animate-spin" : undefined}
                            />
                            <IconButton
                              icon={X}
                              label={`Cancel editing ${h.ticker} holding`}
                              title="Cancel"
                              tone="default"
                              onClick={cancelEdit}
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <IconLink
                              href={`/runs/new?ticker=${encodeURIComponent(h.ticker)}`}
                              icon={Play}
                              label={`Analyze ${h.ticker}`}
                              title="Analyze"
                              tone="primary"
                            />
                            <WatchButton ticker={h.ticker} compact />
                            <IconButton
                              icon={Pencil}
                              label={`Edit ${h.ticker} holding`}
                              title="Edit"
                              tone="default"
                              onClick={() => startEdit(h)}
                            />
                            <IconButton
                              icon={deleteMutation.isPending ? LoaderCircle : Trash2}
                              label={`Delete ${h.ticker} holding`}
                              title="Delete holding"
                              tone="danger"
                              onClick={() => deleteMutation.mutate(h.id)}
                              disabled={deleteMutation.isPending}
                              iconClassName={deleteMutation.isPending ? "animate-spin" : undefined}
                            />
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Fundamentals expand row */}
                    {isExpanded && fundData && (
                      <FundamentalsRow key={`${h.id}-fund`} data={fundData} colSpan={colSpan} />
                    )}

                    {/* Regime expand row */}
                    {isExpanded && regime?.[h.ticker] && (
                      <RegimeRow key={`${h.id}-regime`} data={regime[h.ticker]} colSpan={colSpan} />
                    )}
                  </React.Fragment>
                );
              })
            )}

            {/* New row draft */}
            {addingNew && (
              <tr className="border-t border-input-border bg-input/20">
                <td className="px-3 py-2">
                  <EditInput
                    autoFocus
                    value={newDraft.ticker}
                    onChange={(v) => setNewDraft((d) => ({ ...d, ticker: v }))}
                    onKeyDown={handleNewKey}
                    placeholder="AAPL"
                    className="w-24 uppercase"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex flex-col gap-1 items-end">
                    <EditInput
                      value={newDraft.shares}
                      onChange={(v) => { if (v === "" || /^\d*\.?\d*$/.test(v)) setNewDraft((d) => ({ ...d, shares: v })); }}
                      onKeyDown={handleNewKey}
                      placeholder="shares"
                      className="w-24 text-right"
                    />
                    <EditInput
                      value={newDraft.avg_cost}
                      onChange={(v) => { if (v === "" || /^\d*\.?\d*$/.test(v)) setNewDraft((d) => ({ ...d, avg_cost: v })); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newDraft.avg_cost.trim() === ".") return;
                        handleNewKey(e);
                      }}
                      placeholder="avg cost"
                      className="w-24 text-right"
                    />
                  </div>
                </td>
                <td colSpan={colSpan - 3} />
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <IconButton
                      icon={addMutation.isPending ? LoaderCircle : Check}
                      label="Add holding"
                      title="Add"
                      tone="success"
                      onClick={saveNew}
                      disabled={addMutation.isPending}
                      iconClassName={addMutation.isPending ? "animate-spin" : undefined}
                    />
                    <IconButton
                      icon={X}
                      label="Cancel adding holding"
                      title="Cancel"
                      tone="default"
                      onClick={() => { setAddingNew(false); setNewDraft({ ticker: "", shares: "", avg_cost: "" }); }}
                    />
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!addingNew && (
        <button
          onClick={() => setAddingNew(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg-secondary border border-dashed border-input-border hover:border-border-strong rounded-sm px-3 py-1.5 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add row
        </button>
      )}
    </div>
  );
}
