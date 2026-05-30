import { fmtMoney } from "@/lib/currency";
import type { Portfolio, PortfolioTotals } from "@/lib/types";

interface PortfolioHeaderProps {
  portfolio: Portfolio;
  totals: PortfolioTotals | null;
  displayCurrency: string;
  snapshotDate: string | null;
  broker: string | null;
  hasMissingPrices?: boolean;
  isRefreshing?: boolean;
  onUploadClick: () => void;
  onExportClick: () => void;
  onDeliveryClick: () => void;
  onRefreshClick?: () => void;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function PortfolioHeader({
  portfolio,
  totals,
  displayCurrency,
  snapshotDate,
  broker,
  hasMissingPrices,
  isRefreshing,
  onUploadClick,
  onExportClick,
  onDeliveryClick,
  onRefreshClick,
}: PortfolioHeaderProps) {
  const hasData = totals !== null;
  const pnl = totals?.unrealized_pnl ?? null;
  const pnlPct = totals?.unrealized_pnl_pct ?? null;
  const pnlPositive = pnl != null && pnl >= 0;

  const pnlColor =
    pnl == null ? "text-muted" : pnlPositive ? "text-green-400" : "text-red-400";

  const snapshotLabel = snapshotDate
    ? new Date(snapshotDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-4 bg-input/50 border border-border rounded-sm px-4 py-3">
      {/* Left: portfolio name + meta */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-purple-400 font-medium text-sm truncate">{portfolio.name}</span>
        {portfolio.holding_count > 0 && (
          <span className="text-muted text-xs shrink-0">
            {portfolio.holding_count} position{portfolio.holding_count !== 1 ? "s" : ""}
          </span>
        )}
        {broker && (
          <span className="text-subtle text-xs shrink-0">{broker}</span>
        )}
        {snapshotLabel && (
          <span className="text-subtle text-xs shrink-0">as of {snapshotLabel}</span>
        )}
      </div>

      {/* Spacer */}
      <div className="hidden lg:block flex-1" />

      {/* Right: totals */}
      {hasData ? (
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 shrink-0 w-full lg:w-auto">
          <div className="text-right">
            <div className="text-fg text-sm font-semibold tabular-nums">
              {fmtMoney(totals!.market_value, displayCurrency)}
            </div>
            <div className="text-xs text-muted">Market Value</div>
          </div>
          <div className={`text-right ${pnlColor}`}>
            <div className="text-sm font-semibold tabular-nums">
              {pnl != null && pnl >= 0 ? "+" : ""}{fmtMoney(pnl, displayCurrency)}
              {" "}
              <span className="text-xs font-normal">({fmtPct(pnlPct)})</span>
            </div>
            <div className="text-xs opacity-70">Unrealized P&amp;L</div>
          </div>
        </div>
      ) : (
        <span className="text-subtle text-xs shrink-0">No data yet</span>
      )}

      {/* Divider */}
      <div className="hidden sm:block h-6 w-px bg-muted-surface shrink-0" />

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {onRefreshClick && (
          <button
            onClick={onRefreshClick}
            disabled={isRefreshing}
            title={hasMissingPrices ? "Retry fetching missing prices" : "Refresh prices"}
            aria-label={hasMissingPrices ? "Retry fetching missing prices" : "Refresh prices"}
            className="flex items-center gap-1 text-muted hover:text-fg text-xs px-2 py-1 rounded hover:bg-muted-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className={isRefreshing ? "animate-spin inline-block" : ""}
              style={{ display: "inline-block" }}
            >↻</span>
            {hasMissingPrices && !isRefreshing && (
              <span className="text-amber-400">Retry</span>
            )}
          </button>
        )}
        <button
          onClick={onUploadClick}
          className="flex items-center gap-1 text-muted hover:text-fg text-xs px-2 py-1 rounded-sm hover:bg-muted-surface transition-colors"
        >
          <span>↑</span>
          <span>Upload</span>
        </button>
        <button
          onClick={onExportClick}
          className="flex items-center gap-1 text-muted hover:text-fg text-xs px-2 py-1 rounded-sm hover:bg-muted-surface transition-colors"
        >
          <span>⬇</span>
          <span>Export</span>
        </button>
        <button
          onClick={onDeliveryClick}
          className="flex items-center gap-1 text-muted hover:text-fg text-xs px-2 py-1 rounded-sm hover:bg-muted-surface transition-colors"
          title="Brief delivery settings"
        >
          <span>🔔</span>
        </button>
      </div>
    </div>
  );
}
