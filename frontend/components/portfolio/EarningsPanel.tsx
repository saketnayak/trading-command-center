"use client";
import { useQuery } from "@tanstack/react-query";
import { getPortfolioEarnings } from "@/lib/api";
import {
  portfolioQueryKeys,
  PORTFOLIO_STALE_TIMES,
  PORTFOLIO_EARNINGS_DAYS_AHEAD,
} from "@/lib/portfolioQueries";
import { ALERT_BANNER_CLASS } from "@/lib/uiClasses";
import { finnhubUnavailableMessage } from "@/lib/finnhubMessages";
import { TickerLabel } from "@/components/ui/TickerLabel";
import { useTickerMetadata } from "@/lib/useTickerMetadata";
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

function UnavailableMessage({ message }: { message: string }) {
  return (
    <div className="text-muted text-sm py-6 text-center space-y-1">
      <p>{message}</p>
      <p>
        <a href="/settings" className="text-blue-400 hover:underline">Open Settings</a>
      </p>
    </div>
  );
}

export function EarningsPanel({ portfolioId, holdings, priceUnavailableReason }: Props) {
  const noKey = priceUnavailableReason === "no_finnhub_key";

  const { data, isLoading, isError } = useQuery({
    queryKey: portfolioQueryKeys.earnings(portfolioId),
    queryFn: () => getPortfolioEarnings(portfolioId, PORTFOLIO_EARNINGS_DAYS_AHEAD),
    staleTime: PORTFOLIO_STALE_TIMES.earnings,
    enabled: !noKey,
  });

  const events = data?.events ?? [];
  const { data: tickerMetadata = {} } = useTickerMetadata(events.map((e) => e.ticker), {
    enabled: events.length > 0,
  });
  const unavailableReason = data?.earnings_unavailable_reason ?? (noKey ? "no_finnhub_key" : null);
  const unavailableMessage = finnhubUnavailableMessage(unavailableReason, "earnings");

  if (noKey && unavailableMessage) {
    return <UnavailableMessage message={unavailableMessage} />;
  }

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
      <UnavailableMessage message="Could not load earnings data. Check your Finnhub API key in Settings." />
    );
  }

  if (unavailableMessage && events.length === 0) {
    return <UnavailableMessage message={unavailableMessage} />;
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
      {unavailableMessage && (
        <div className={ALERT_BANNER_CLASS}>
          {unavailableMessage}
        </div>
      )}
      <p className="text-xs text-muted">
        Upcoming earnings dates for your holdings (next 60 days). Dates flagged{" "}
        <span className="text-yellow-400">yellow</span> have stale or missing analysis.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
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
              return (
                <tr
                  key={`${e.ticker}-${e.date}-${i}`}
                  className={`border-t border-border ${isStale ? "bg-yellow-900/10" : ""}`}
                >
                  <td className="px-4 py-2.5">
                    <TickerLabel
                      ticker={e.ticker}
                      metadata={tickerMetadata[e.ticker.toUpperCase()]}
                    />
                  </td>
                  <td className={`px-4 py-2.5 text-xs ${isStale ? "text-yellow-400" : ""}`}>{e.date}</td>
                  <td className={`px-4 py-2.5 text-right text-xs ${days <= 7 ? "text-orange-400" : ""}`}>
                    {days}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2.5 text-right text-xs font-mono">
                    {fmtNum(e.eps_estimate)}
                  </td>
                  <td className={`hidden lg:table-cell px-4 py-2.5 text-right text-xs font-mono ${
                    e.eps_actual != null && e.eps_estimate != null
                      ? e.eps_actual >= e.eps_estimate ? "text-green-400" : "text-red-400"
                      : ""
                  }`}>
                    {fmtNum(e.eps_actual)}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2.5 text-right text-xs font-mono">
                    {e.revenue_estimate != null ? (e.revenue_estimate / 1e9).toFixed(2) : "—"}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2.5 text-right text-xs text-muted">
                    {e.quarter_ending ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
