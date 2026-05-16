"use client";
import React, { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { addHolding, updateHolding, deleteHolding, getLatestRunsByTicker, type LatestRunEntry } from "@/lib/api";
import { fmtMoney, fmtPnl } from "@/lib/currency";
import { WatchButton } from "@/components/portfolio/WatchButton";
import type { PortfolioHolding, FundamentalsData } from "@/lib/types";

interface HoldingsTableProps {
  portfolioId: string;
  holdings: PortfolioHolding[];
  priceUnavailableReason: string | null;
  displayCurrency: string;
  fundamentals?: Record<string, FundamentalsData>;
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
}: {
  label: string;
  colKey: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === colKey;
  const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th
      className={`px-4 py-3 text-${align} cursor-pointer select-none group whitespace-nowrap`}
      onClick={() => onSort(colKey)}
    >
      <span className={active ? "text-blue-400" : "group-hover:text-slate-200 transition-colors"}>
        {label}
        {active ? (
          <span className="text-blue-400">{arrow}</span>
        ) : (
          <span className="text-slate-600 group-hover:text-slate-400 ml-0.5">↕</span>
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
      className={`bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500 ${className ?? ""}`}
    />
  );
}

function FundamentalsRow({ data, colSpan }: { data: FundamentalsData; colSpan: number }) {
  const metrics: Array<{ label: string; value: string }> = data.asset_type === "crypto"
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
        { label: "Beta", value: fmtNum(data.beta ?? null) },
        { label: "52w High", value: data.week52_high != null ? `$${data.week52_high.toFixed(2)}` : "—" },
        { label: "52w Low", value: data.week52_low != null ? `$${data.week52_low.toFixed(2)}` : "—" },
        { label: "Div Yield", value: fmtNum(data.dividend_yield ?? null, 2, "%") },
        { label: "EPS (TTM)", value: data.eps_ttm != null ? `$${data.eps_ttm.toFixed(2)}` : "—" },
        { label: "Mkt Cap", value: fmtLargeNum(data.market_cap ?? null) },
      ];

  return (
    <tr className="border-t border-slate-700/50 bg-slate-800/20">
      <td colSpan={colSpan} className="px-6 py-2">
        <div className="flex flex-wrap gap-4">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">{m.label}</span>
              <span className="text-xs text-slate-300 font-mono">{m.value}</span>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

export function HoldingsTable({ portfolioId, holdings, priceUnavailableReason, displayCurrency, fundamentals, onTickerClick }: HoldingsTableProps) {
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
  const newTickerRef = useRef<HTMLInputElement>(null);

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
  const { data: latestRuns = {} } = useQuery({
    queryKey: ["latest-runs-by-ticker", tickers],
    queryFn: () => getLatestRunsByTicker(tickers),
    enabled: tickers.length > 0,
    staleTime: 60_000,
  });

  const isFiltered = filterTicker !== "" || filterSignal !== "";

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
    return result;
  }, [holdings, filterTicker, filterSignal, latestRuns]);

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
  const colSpan = hasFundamentals ? 9 : 8;

  return (
    <div className="space-y-3">
      {priceUnavailableReason === "no_finnhub_key" && (
        <div className="text-xs text-slate-400 bg-slate-800/50 border border-slate-700 rounded px-3 py-2">
          Live prices unavailable — add your Finnhub API key in{" "}
          <Link href="/settings" className="text-blue-400 hover:underline">Settings</Link>.
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={filterTicker}
          onChange={(e) => setFilterTicker(e.target.value)}
          placeholder="Filter by ticker…"
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 w-40 focus:outline-none focus:border-blue-500 placeholder-slate-500"
        />
        <select
          value={filterSignal}
          onChange={(e) => setFilterSignal(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
        >
          <option value="">All signals</option>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
          <option value="hold">Hold</option>
          <option value="none">Not analyzed</option>
        </select>
        {isFiltered && (
          <>
            <span className="text-xs text-slate-500">
              {filteredHoldings.length} of {holdings.length}
            </span>
            <button
              onClick={() => { setFilterTicker(""); setFilterSignal(""); }}
              className="text-xs text-slate-500 hover:text-slate-300 underline"
            >
              Clear
            </button>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded border border-slate-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-navy-700 text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              {hasFundamentals && <th className="w-6 px-2 py-3" />}
              <SortableHeader label="Ticker"         colKey="ticker"         sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
              <SortableHeader label="Shares"         colKey="shares"         sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Avg Cost"       colKey="avg_cost"       sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Current Price"  colKey="current_price"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Market Value"   colKey="market_value"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Unrealized P&L" colKey="unrealized_pnl" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className="text-left px-4 py-3 whitespace-nowrap text-slate-400 text-xs uppercase tracking-wider">Last Analysis</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedHoldings.length === 0 && !addingNew ? (
              <tr>
                <td colSpan={colSpan} className="text-center text-slate-500 px-4 py-8">
                  {isFiltered ? "No holdings match the current filters." : "No holdings. Add a row below or upload a CSV."}
                </td>
              </tr>
            ) : (
              sortedHoldings.map((h) => {
                const isEditing = editingId === h.id;
                const isExpanded = expandedIds.has(h.id);
                const fundData = fundamentals?.[h.ticker] ?? null;
                const pnl = h.unrealized_pnl;
                const pnlColor = pnl == null ? "text-slate-500" : pnl >= 0 ? "text-green-400" : "text-red-400";
                const rowEntry = latestRuns[h.ticker] ?? null;
                const rowTint = rowEntry != null && daysAgo(rowEntry.completed_at) <= 14
                  ? rowEntry.verdict === "buy" ? "bg-emerald-900/20"
                  : rowEntry.verdict === "sell" ? "bg-red-900/20"
                  : ""
                  : "";

                return (
                  <React.Fragment key={h.id}>
                    <tr className={`border-t border-slate-800 hover:bg-slate-800/30 ${rowTint}`}>
                      {/* Expand toggle */}
                      {hasFundamentals && (
                        <td className="px-2 py-2">
                          {fundData && (
                            <button
                              onClick={() => toggleExpand(h.id)}
                              className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
                              title="Show fundamentals"
                            >
                              {isExpanded ? "▾" : "▸"}
                            </button>
                          )}
                        </td>
                      )}

                      {/* Ticker */}
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <EditInput
                            autoFocus
                            value={editDraft.ticker}
                            onChange={(v) => setEditDraft((d) => ({ ...d, ticker: v }))}
                            onKeyDown={handleEditKey}
                            className="w-24 uppercase"
                          />
                        ) : onTickerClick ? (
                          <button
                            onClick={() => onTickerClick(h)}
                            className="font-mono text-purple-400 hover:text-purple-300 hover:underline transition-colors"
                          >
                            {h.ticker}
                          </button>
                        ) : h.last_run ? (
                          <Link href={`/runs/${h.last_run.run_id}`} className="font-mono text-purple-400 hover:underline">
                            {h.ticker}
                          </Link>
                        ) : (
                          <span className="font-mono text-purple-400">{h.ticker}</span>
                        )}
                      </td>

                      {/* Shares */}
                      <td className="px-4 py-2 text-right tabular-nums">
                        {isEditing ? (
                          <EditInput
                            value={editDraft.shares}
                            onChange={(v) => setEditDraft((d) => ({ ...d, shares: v }))}
                            onKeyDown={handleEditKey}
                            className="w-24 text-right"
                          />
                        ) : (
                          <span className="text-slate-300">{h.shares.toLocaleString("en-US")}</span>
                        )}
                      </td>

                      {/* Avg Cost */}
                      <td className="px-4 py-2 text-right tabular-nums">
                        {isEditing ? (
                          <EditInput
                            value={editDraft.avg_cost}
                            onChange={(v) => setEditDraft((d) => ({ ...d, avg_cost: v }))}
                            onKeyDown={handleEditKey}
                            placeholder="—"
                            className="w-24 text-right"
                          />
                        ) : (
                          <span className="text-slate-400">{fmtMoney(h.avg_cost, displayCurrency)}</span>
                        )}
                      </td>

                      {/* Current Price (read-only) */}
                      <td className="px-4 py-2 text-right text-slate-300 tabular-nums">{fmtMoney(h.current_price, displayCurrency)}</td>

                      {/* Market Value (read-only) */}
                      <td className="px-4 py-2 text-right text-slate-300 tabular-nums">{fmtMoney(h.market_value, displayCurrency)}</td>

                      {/* Unrealized P&L (read-only) */}
                      <td className={`px-4 py-2 text-right tabular-nums ${pnlColor}`}>
                        {fmtPnl(pnl, h.unrealized_pnl_pct, displayCurrency)}
                      </td>

                      {/* Last Analysis */}
                      <td className="px-3 py-2 text-right">
                        {(() => {
                          const entry: LatestRunEntry | null | undefined = latestRuns[h.ticker];
                          if (!entry) {
                            return <span className="text-xs text-slate-600 italic">Never analyzed</span>;
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
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${verdictColors[entry.verdict] ?? "bg-slate-700 text-slate-200"}`}>
                                {entry.verdict.toUpperCase()}
                              </span>
                              <span className={`text-xs ${stale ? "text-amber-400" : "text-slate-500"}`}>
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

                      {/* Actions */}
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={saveEdit}
                              disabled={updateMutation.isPending}
                              className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                            >
                              {updateMutation.isPending ? "Saving…" : "Save"}
                            </button>
                            <button onClick={cancelEdit} className="text-xs text-slate-500 hover:text-slate-300">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 flex-wrap">
                            <Link
                              href={`/runs/new?ticker=${encodeURIComponent(h.ticker)}`}
                              className="text-xs text-slate-400 hover:text-blue-400 transition-colors"
                            >
                              Analyze
                            </Link>
                            <WatchButton ticker={h.ticker} />
                            <button
                              onClick={() => startEdit(h)}
                              className="text-xs text-slate-500 hover:text-slate-200 transition-colors"
                              title="Edit"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteMutation.mutate(h.id)}
                              disabled={deleteMutation.isPending}
                              className="text-xs text-slate-600 hover:text-red-400 transition-colors disabled:opacity-50"
                              title="Delete"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Fundamentals expand row */}
                    {isExpanded && fundData && (
                      <FundamentalsRow key={`${h.id}-fund`} data={fundData} colSpan={colSpan} />
                    )}
                  </React.Fragment>
                );
              })
            )}

            {/* New row draft */}
            {addingNew && (
              <tr className="border-t border-slate-700 bg-slate-800/20">
                {hasFundamentals && <td className="px-2 py-2" />}
                <td className="px-4 py-2">
                  <EditInput
                    autoFocus
                    value={newDraft.ticker}
                    onChange={(v) => setNewDraft((d) => ({ ...d, ticker: v }))}
                    onKeyDown={handleNewKey}
                    placeholder="AAPL"
                    className="w-24 uppercase"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <EditInput
                    value={newDraft.shares}
                    onChange={(v) => setNewDraft((d) => ({ ...d, shares: v }))}
                    onKeyDown={handleNewKey}
                    placeholder="0"
                    className="w-24 text-right"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <EditInput
                    value={newDraft.avg_cost}
                    onChange={(v) => setNewDraft((d) => ({ ...d, avg_cost: v }))}
                    onKeyDown={handleNewKey}
                    placeholder="0.00"
                    className="w-24 text-right"
                  />
                </td>
                <td colSpan={3} />
                <td />
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveNew}
                      disabled={addMutation.isPending}
                      className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                    >
                      {addMutation.isPending ? "Adding…" : "Add"}
                    </button>
                    <button
                      onClick={() => { setAddingNew(false); setNewDraft({ ticker: "", shares: "", avg_cost: "" }); }}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      Cancel
                    </button>
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
          className="text-xs text-slate-500 hover:text-slate-300 border border-dashed border-slate-700 hover:border-slate-500 rounded px-3 py-1.5 transition-colors"
        >
          + Add row
        </button>
      )}
    </div>
  );
}
