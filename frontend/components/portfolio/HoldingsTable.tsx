"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addHolding, updateHolding, deleteHolding } from "@/lib/api";
import type { PortfolioHolding } from "@/lib/types";

interface HoldingsTableProps {
  portfolioId: string;
  holdings: PortfolioHolding[];
  priceUnavailableReason: string | null;
}

interface DraftRow {
  ticker: string;
  shares: string;
  avg_cost: string;
}

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

function fmtPnl(pnl: number | null, pct: number | null): string {
  if (pnl == null) return "—";
  const sign = pnl >= 0 ? "+" : "";
  const pctStr = pct != null ? ` (${pnl >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : "";
  return `${sign}${fmtMoney(pnl)}${pctStr}`;
}

const verdictBadge: Record<string, string> = {
  buy: "bg-green-500/20 text-green-300 border border-green-500/30",
  sell: "bg-red-500/20 text-red-300 border border-red-500/30",
  hold: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
};

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

export function HoldingsTable({ portfolioId, holdings, priceUnavailableReason }: HoldingsTableProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow>({ ticker: "", shares: "", avg_cost: "" });
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<DraftRow>({ ticker: "", shares: "", avg_cost: "" });
  const newTickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingNew) newTickerRef.current?.focus();
  }, [addingNew]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["portfolio-current", portfolioId] });
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

  return (
    <div className="space-y-3">
      {priceUnavailableReason === "no_finnhub_key" && (
        <div className="text-xs text-slate-400 bg-slate-800/50 border border-slate-700 rounded px-3 py-2">
          Live prices unavailable — add your Finnhub API key in{" "}
          <Link href="/settings" className="text-blue-400 hover:underline">Settings</Link>.
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-navy-700 text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Ticker</th>
              <th className="text-right px-4 py-3">Shares</th>
              <th className="text-right px-4 py-3">Avg Cost</th>
              <th className="text-right px-4 py-3">Current Price</th>
              <th className="text-right px-4 py-3">Market Value</th>
              <th className="text-right px-4 py-3">Unrealized P&amp;L</th>
              <th className="text-left px-4 py-3">Last Analysis</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 && !addingNew ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-500 px-4 py-8">
                  No holdings. Add a row below or upload a CSV.
                </td>
              </tr>
            ) : (
              holdings.map((h) => {
                const isEditing = editingId === h.id;
                const pnl = h.unrealized_pnl;
                const pnlColor = pnl == null ? "text-slate-500" : pnl >= 0 ? "text-green-400" : "text-red-400";
                const verdictKey = h.last_run?.verdict?.toLowerCase() ?? "";
                const badgeClass = verdictBadge[verdictKey] ?? "bg-slate-700 text-slate-300 border border-slate-600";

                return (
                  <tr key={h.id} className="border-t border-slate-800 hover:bg-slate-800/30">
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
                        <span className="text-slate-400">{fmtMoney(h.avg_cost)}</span>
                      )}
                    </td>

                    {/* Current Price (read-only) */}
                    <td className="px-4 py-2 text-right text-slate-300 tabular-nums">{fmtMoney(h.current_price)}</td>

                    {/* Market Value (read-only) */}
                    <td className="px-4 py-2 text-right text-slate-300 tabular-nums">{fmtMoney(h.market_value)}</td>

                    {/* Unrealized P&L (read-only) */}
                    <td className={`px-4 py-2 text-right tabular-nums ${pnlColor}`}>
                      {fmtPnl(pnl, h.unrealized_pnl_pct)}
                    </td>

                    {/* Last Analysis */}
                    <td className="px-4 py-2">
                      {h.last_run ? (
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                            {(h.last_run.verdict ?? "").toUpperCase()}
                          </span>
                          <Link href={`/runs/${h.last_run.run_id}`} className="text-xs text-slate-400 hover:text-slate-200">
                            {daysAgo(h.last_run.analysis_date)}d ago →
                          </Link>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-xs">Not analyzed</span>
                      )}
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
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/runs/new?ticker=${encodeURIComponent(h.ticker)}`}
                            className="text-xs text-slate-400 hover:text-blue-400 transition-colors"
                          >
                            Analyze
                          </Link>
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
                );
              })
            )}

            {/* New row draft */}
            {addingNew && (
              <tr className="border-t border-slate-700 bg-slate-800/20">
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
