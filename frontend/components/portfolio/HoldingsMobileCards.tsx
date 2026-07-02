"use client";

import Link from "next/link";
import { Check, LoaderCircle, Pencil, Play, Trash2, X } from "lucide-react";
import { fmtMoney, fmtPnl, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { analysisFromLastRun } from "@/lib/holdingLastRun";
import { WatchButton } from "@/components/portfolio/WatchButton";
import { IconButton, IconLink } from "@/components/ui/IconButton";
import { TickerLabel } from "@/components/ui/TickerLabel";
import { WaveBadge } from "@/components/wave/WaveBadge";
import type {
  FundamentalsData,
  PortfolioHolding,
  RegimeData,
  TickerMetadata,
  TrimSignalEntry,
  WaveSummary,
} from "@/lib/types";

type DraftRow = {
  ticker: string;
  shares: string;
  avg_cost: string;
  currency: string;
};

type HoldingsMobileCardsProps = {
  holdings: PortfolioHolding[];
  displayCurrency: string;
  fundamentals?: Record<string, FundamentalsData>;
  regime?: Record<string, RegimeData>;
  wave?: Record<string, WaveSummary>;
  trimSignals?: Record<string, TrimSignalEntry>;
  tickerMetadata?: Record<string, TickerMetadata>;
  onTickerClick?: (holding: PortfolioHolding) => void;
  editingId: string | null;
  editDraft: DraftRow;
  setEditDraft: React.Dispatch<React.SetStateAction<DraftRow>>;
  onStartEdit: (holding: PortfolioHolding) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  editSaving: boolean;
  onDelete: (id: string) => void;
  deletePending: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
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
      className={`bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500 ${className ?? ""}`}
    />
  );
}

function VerdictBadge({ holding }: { holding: PortfolioHolding }) {
  const entry = analysisFromLastRun(holding.last_run);
  if (!entry) {
    return <span className="text-xs text-subtle italic">Not analyzed</span>;
  }

  const days = daysAgo(entry.completed_at);
  const stale = days > 14;
  const verdictColors: Record<string, string> = {
    buy: "bg-emerald-700 text-emerald-100",
    sell: "bg-red-700 text-red-100",
    hold: "bg-amber-700 text-amber-100",
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${verdictColors[entry.verdict] ?? "bg-muted-surface text-fg"}`}
      >
        {entry.verdict.toUpperCase()}
      </span>
      <span className={`text-xs ${stale ? "text-amber-400" : "text-muted"}`}>
        {days === 0 ? "today" : `${days}d ago`}
        {stale ? " ⚠" : ""}
      </span>
      <Link href={`/runs/${entry.run_id}`} className="text-xs text-blue-400 hover:underline">
        View run
      </Link>
    </div>
  );
}

export function HoldingsMobileCards({
  holdings,
  displayCurrency,
  fundamentals,
  regime,
  wave,
  trimSignals,
  tickerMetadata,
  onTickerClick,
  editingId,
  editDraft,
  setEditDraft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  editSaving,
  onDelete,
  deletePending,
  expandedIds,
  onToggleExpand,
}: HoldingsMobileCardsProps) {
  return (
    <div className="space-y-3 md:hidden">
      {holdings.map((holding) => {
        const isEditing = editingId === holding.id;
        const isExpanded = expandedIds.has(holding.id);
        const fundData = fundamentals?.[holding.ticker] ?? null;
        const regimeData = regime?.[holding.ticker];
        const pnl = holding.unrealized_pnl;
        const pnlColor = pnl == null ? "text-muted" : pnl >= 0 ? "text-green-400" : "text-red-400";
        const tickerMeta = tickerMetadata?.[holding.ticker.toUpperCase()];
        const canExpand = Boolean(fundData || regimeData);

        return (
          <article
            key={holding.id}
            className="rounded-lg border border-border bg-surface p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <EditInput
                    autoFocus
                    value={editDraft.ticker}
                    onChange={(v) => setEditDraft((d) => ({ ...d, ticker: v }))}
                    className="w-full uppercase"
                    placeholder="Ticker"
                  />
                ) : (
                  <TickerLabel
                    ticker={holding.ticker}
                    metadata={tickerMeta}
                    onClick={onTickerClick ? () => onTickerClick(holding) : undefined}
                    href={
                      !onTickerClick && holding.last_run
                        ? `/runs/${holding.last_run.run_id}`
                        : undefined
                    }
                  />
                )}
              </div>
              {!isEditing && (
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold font-data text-fg">
                    {fmtMoney(holding.market_value, holding.quote_currency ?? displayCurrency)}
                  </p>
                  <p className="text-[10px] text-muted uppercase tracking-wide">Value</p>
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="grid grid-cols-2 gap-2">
                <EditInput
                  value={editDraft.shares}
                  onChange={(v) => {
                    if (v === "" || /^\d*\.?\d*$/.test(v)) setEditDraft((d) => ({ ...d, shares: v }));
                  }}
                  placeholder="Shares"
                  className="text-right"
                />
                <EditInput
                  value={editDraft.avg_cost}
                  onChange={(v) => {
                    if (v === "" || /^\d*\.?\d*$/.test(v)) setEditDraft((d) => ({ ...d, avg_cost: v }));
                  }}
                  placeholder="Avg cost"
                  className="text-right"
                />
                <select
                  value={editDraft.currency}
                  onChange={(e) => setEditDraft((d) => ({ ...d, currency: e.target.value }))}
                  className="col-span-2 bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg"
                  aria-label="Cost basis currency"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="text-muted">Position </span>
                    <span className="font-data text-fg-secondary">
                      {holding.shares.toLocaleString("en-US")} sh @{" "}
                      {fmtMoney(holding.avg_cost, holding.cost_basis_currency ?? holding.currency ?? displayCurrency)}
                    </span>
                  </div>
                  <div className={`font-data font-semibold ${pnlColor}`}>
                    {fmtPnl(pnl, holding.unrealized_pnl_pct, holding.quote_currency ?? displayCurrency)}
                  </div>
                </div>

                <VerdictBadge holding={holding} />

                <div className="flex flex-wrap items-center gap-1.5">
                  {wave?.[holding.ticker.toUpperCase()] && (
                    <WaveBadge data={wave[holding.ticker.toUpperCase()]} />
                  )}
                  {trimSignals?.[holding.id]?.level && trimSignals[holding.id].level !== "none" && (
                    <span className="text-[10px] text-orange-400">Trim signal</span>
                  )}
                </div>
              </>
            )}

            {canExpand && !isEditing && (
              <>
                <button
                  type="button"
                  onClick={() => onToggleExpand(holding.id)}
                  className="text-xs text-blue-400 hover:underline"
                >
                  {isExpanded ? "Hide details" : "Show fundamentals & regime"}
                </button>
                {isExpanded && (
                  <div className="rounded-sm bg-input/30 px-3 py-2 text-xs text-fg-secondary space-y-1">
                    {fundData?.pe_ratio != null && <p>P/E: {fundData.pe_ratio.toFixed(1)}</p>}
                    {fundData?.peg_ratio != null && <p>PEG: {fundData.peg_ratio.toFixed(2)}</p>}
                    {regimeData && (
                      <p>
                        Regime: {regimeData.current_regime} (signal{" "}
                        {regimeData.signal >= 0 ? "+" : ""}
                        {regimeData.signal.toFixed(2)})
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
              {isEditing ? (
                <>
                  <IconButton
                    icon={editSaving ? LoaderCircle : Check}
                    label={`Save ${holding.ticker} holding`}
                    title="Save"
                    tone="success"
                    onClick={onSaveEdit}
                    disabled={editSaving}
                    iconClassName={editSaving ? "animate-spin" : undefined}
                  />
                  <IconButton
                    icon={X}
                    label={`Cancel editing ${holding.ticker} holding`}
                    title="Cancel"
                    tone="default"
                    onClick={onCancelEdit}
                  />
                </>
              ) : (
                <>
                  <IconLink
                    href={`/runs/new?ticker=${encodeURIComponent(holding.ticker)}`}
                    icon={Play}
                    label={`Analyze ${holding.ticker}`}
                    title="Analyze"
                    tone="primary"
                  />
                  <WatchButton ticker={holding.ticker} compact />
                  <IconButton
                    icon={Pencil}
                    label={`Edit ${holding.ticker} holding`}
                    title="Edit"
                    tone="default"
                    onClick={() => onStartEdit(holding)}
                  />
                  <IconButton
                    icon={deletePending ? LoaderCircle : Trash2}
                    label={`Delete ${holding.ticker} holding`}
                    title="Delete"
                    tone="danger"
                    onClick={() => onDelete(holding.id)}
                    disabled={deletePending}
                    iconClassName={deletePending ? "animate-spin" : undefined}
                  />
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
