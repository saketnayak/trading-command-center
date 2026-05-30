"use client";
import { useQuery } from "@tanstack/react-query";
import { getPortfolioEarnings } from "@/lib/api";
import type { PortfolioHolding } from "@/lib/types";

interface Props {
  portfolioId: string;
  holdings: PortfolioHolding[];
  priceUnavailableReason: string | null;
}

const STALE_DAYS = 7;

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

function fmtNum(n: number | null, prefix = ""): string {
  if (n == null) return "—";
  return `${prefix}${n.toFixed(2)}`;
}

const NO_KEY_MSG = (
  <div className="text-muted text-sm py-6 text-center">
    Could not load earnings data. Add a <a href="/settings" className="text-blue-400 hover:underline">Finnhub API key in Settings</a>.
  </div>
);

export function EarningsPanel({ portfolioId, holdings, priceUnavailableReason }: Props) {
  const noKey = priceUnavailableReason === "no_finnhub_key";

  const { data: events = [], isLoading, isError } = useQuery({
    queryKey: ["portfolio-earnings", portfolioId],
    queryFn: () => getPortfolioEarnings(portfolioId, 60),
    staleTime: 1000 * 60 * 30,
    enabled: !noKey,
  });

  if (noKey) return NO_KEY_MSG;

  const staleSet = new Set(
    holdings
      .filter((h) => !h.last_run || daysAgo(h.last_run.analysis_date) > STALE_DAYS)
      .map((h) => h.ticker),
  );

  if (isLoading) {
    return <div className="text-muted text-sm py-8 text-center">Loading earnings calendar…</div>;
  }

  if (isError) {
    return (
      <div className="text-muted text-sm py-6 text-center">
        Could not load earnings data. Add a Finnhub API key in Settings.
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-muted text-sm py-8 text-center">
        No upcoming earnings found for your holdings in the next 60 days.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Upcoming earnings dates for your holdings (next 60 days). Dates flagged{" "}
        <span className="text-yellow-400">yellow</span> have stale or missing analysis.
      </p>
      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Ticker</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-right px-4 py-3">Days Away</th>
              <th className="hidden lg:table-cell text-right px-4 py-3">EPS Est.</th>
              <th className="hidden lg:table-cell text-right px-4 py-3">EPS Actual</th>
              <th className="hidden lg:table-cell text-right px-4 py-3">Rev. Est. ($B)</th>
              <th className="hidden lg:table-cell text-right px-4 py-3">Quarter</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => {
              const days = daysUntil(e.date);
              const isStale = staleSet.has(e.ticker);
              const isPast = days < 0;
              return (
                <tr
                  key={`${e.ticker}-${e.date}-${i}`}
                  className={`border-t border-border ${isPast ? "opacity-50" : "hover:bg-input/30"}`}
                >
                  <td className={`px-4 py-2 font-mono font-semibold ${isStale && !isPast ? "text-yellow-400" : "text-purple-400"}`}>
                    {e.ticker}
                    {isStale && !isPast && (
                      <span className="ml-1.5 text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-sm px-1">
                        STALE
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">{e.date}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <span
                      className={
                        isPast
                          ? "text-muted"
                          : days <= 7
                          ? "text-orange-400 font-semibold"
                          : days <= 14
                          ? "text-yellow-400"
                          : "text-fg-secondary"
                      }
                    >
                      {isPast ? `${Math.abs(days)}d ago` : `${days}d`}
                    </span>
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2 text-right tabular-nums text-fg-secondary">{fmtNum(e.eps_estimate, "$")}</td>
                  <td className="hidden lg:table-cell px-4 py-2 text-right tabular-nums">
                    {e.eps_actual != null ? (
                      <span className={e.eps_actual >= (e.eps_estimate ?? 0) ? "text-green-400" : "text-red-400"}>
                        {fmtNum(e.eps_actual, "$")}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2 text-right tabular-nums text-fg-secondary">
                    {e.revenue_estimate != null ? (e.revenue_estimate / 1e9).toFixed(2) : "—"}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2 text-right text-muted text-xs">{e.quarter_ending ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
