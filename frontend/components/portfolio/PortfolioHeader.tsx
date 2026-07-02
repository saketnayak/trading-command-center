import type { Portfolio } from "@/lib/types";

interface PortfolioHeaderProps {
  portfolio: Portfolio;
  preferredCurrency: string;
  portfolioCurrencies: string[];
  snapshotDate: string | null;
  broker: string | null;
  totalsUnavailable?: boolean;
}

export function PortfolioHeader({
  portfolio,
  preferredCurrency,
  portfolioCurrencies,
  snapshotDate,
  broker,
  totalsUnavailable = false,
}: PortfolioHeaderProps) {
  const mixedCurrencies =
    portfolioCurrencies.length > 1 ||
    (portfolioCurrencies.length === 1 && portfolioCurrencies[0] !== preferredCurrency);

  const snapshotLabel = snapshotDate
    ? new Date(snapshotDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-input/30 px-4 py-2 text-xs text-muted">
      {portfolio.holding_count > 0 && (
        <span className="shrink-0">
          {portfolio.holding_count} position{portfolio.holding_count !== 1 ? "s" : ""}
        </span>
      )}
      {broker && <span className="shrink-0">{broker}</span>}
      {snapshotLabel && <span className="shrink-0">Snapshot {snapshotLabel}</span>}
      {portfolioCurrencies.length > 0 && (
        <span className="shrink-0">Quotes: {portfolioCurrencies.join(", ")}</span>
      )}
      {totalsUnavailable && mixedCurrencies && (
        <span className="text-subtle shrink-0">
          Totals hidden — mixed currencies or no {preferredCurrency} holdings
        </span>
      )}
      {!totalsUnavailable && portfolio.holding_count === 0 && (
        <span className="text-subtle shrink-0">No holdings yet</span>
      )}
    </div>
  );
}
