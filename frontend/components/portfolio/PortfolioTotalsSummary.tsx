import { fmtMoney } from "@/lib/currency";
import type { PortfolioTotals } from "@/lib/types";

type PortfolioTotalsSummaryProps = {
  totals: PortfolioTotals;
  totalsCurrency: string;
};

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function PortfolioTotalsSummary({ totals, totalsCurrency }: PortfolioTotalsSummaryProps) {
  const pnl = totals.unrealized_pnl ?? null;
  const pnlPct = totals.unrealized_pnl_pct ?? null;
  const pnlPositive = pnl != null && pnl >= 0;
  const pnlColor = pnl == null ? "text-muted" : pnlPositive ? "text-green-400" : "text-red-400";

  return (
    <div className="flex flex-wrap items-baseline justify-end gap-x-5 gap-y-1">
      <div className="text-right">
        <div className="text-lg sm:text-2xl font-semibold font-data tabular-nums text-fg">
          {fmtMoney(totals.market_value, totalsCurrency)}
        </div>
        <div className="text-xs text-muted">Market value ({totalsCurrency})</div>
      </div>
      <div className={`text-right ${pnlColor}`}>
        <div className="text-base sm:text-lg font-semibold font-data tabular-nums">
          {pnl != null && pnl >= 0 ? "+" : ""}
          {fmtMoney(pnl, totalsCurrency)}{" "}
          <span className="text-sm font-normal">({fmtPct(pnlPct)})</span>
        </div>
        <div className="text-xs opacity-80">Unrealized P&amp;L</div>
      </div>
    </div>
  );
}
