import { fmtMoney } from "@/lib/currency";
import type { Portfolio, PortfolioTotals } from "@/lib/types";

interface PortfolioHeaderProps {
  portfolio: Portfolio;
  totals: PortfolioTotals | null;
  totalsCurrency: string | null;
  preferredCurrency: string;
  portfolioCurrencies: string[];
  snapshotDate: string | null;
  broker: string | null;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function PortfolioHeader({
  portfolio,
  totals,
  totalsCurrency,
  preferredCurrency,
  portfolioCurrencies,
  snapshotDate,
  broker,
}: PortfolioHeaderProps) {
  const hasTotals = totals !== null && totalsCurrency !== null;
  const pnl = totals?.unrealized_pnl ?? null;
  const pnlPct = totals?.unrealized_pnl_pct ?? null;
  const pnlPositive = pnl != null && pnl >= 0;
  const mixedCurrencies =
    portfolioCurrencies.length > 1 ||
    (portfolioCurrencies.length === 1 && portfolioCurrencies[0] !== preferredCurrency);

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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-input/50 border border-border rounded-sm px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
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
        {portfolioCurrencies.length > 0 && (
          <span className="text-subtle text-xs shrink-0">
            Quote: {portfolioCurrencies.join(", ")}
          </span>
        )}
      </div>

      {hasTotals ? (
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 shrink-0">
          <div className="text-right">
            <div className="text-fg text-sm font-semibold tabular-nums">
              {fmtMoney(totals!.market_value, totalsCurrency!)}
            </div>
            <div className="text-xs text-muted">Market Value ({totalsCurrency})</div>
          </div>
          <div className={`text-right ${pnlColor}`}>
            <div className="text-sm font-semibold tabular-nums">
              {pnl != null && pnl >= 0 ? "+" : ""}{fmtMoney(pnl, totalsCurrency!)}
              {" "}
              <span className="text-xs font-normal">({fmtPct(pnlPct)})</span>
            </div>
            <div className="text-xs opacity-70">Unrealized P&amp;L</div>
          </div>
        </div>
      ) : totals !== null && mixedCurrencies ? (
        <span className="text-subtle text-xs shrink-0">
          Totals hidden — mixed currencies or no {preferredCurrency} holdings
        </span>
      ) : (
        <span className="text-subtle text-xs shrink-0">No data yet</span>
      )}
    </div>
  );
}
