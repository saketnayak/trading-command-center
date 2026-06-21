"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatRelativeSeconds } from "@/lib/formatRelativeTime";
import {
  buildPortfolioPrefetchQueryKeys,
  portfolioQueryKeys,
} from "@/lib/portfolioQueries";

export interface PortfolioFreshnessOptions {
  portfolioId: string | null;
  markovEnabled: boolean;
  waveEnabled: boolean;
  isFetching: boolean;
}

function computeFreshnessLabel(
  portfolioId: string | null,
  markovEnabled: boolean,
  waveEnabled: boolean,
  isFetching: boolean,
  queryClient: ReturnType<typeof useQueryClient>,
  now: number
): string | null {
  if (!portfolioId) return null;
  if (isFetching) return "Updating…";

  const queryKeys = buildPortfolioPrefetchQueryKeys(portfolioId, {
    markovEnabled,
    waveEnabled,
  }).filter((key) => key !== portfolioQueryKeys.list);

  let latestUpdatedAt = 0;
  for (const queryKey of queryKeys) {
    const updatedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
    if (updatedAt > latestUpdatedAt) {
      latestUpdatedAt = updatedAt;
    }
  }

  if (latestUpdatedAt === 0) return null;

  const secondsAgo = Math.floor((now - latestUpdatedAt) / 1000);
  return `Updated ${formatRelativeSeconds(secondsAgo)}`;
}

function freshnessTickMs(label: string | null): number {
  if (!label || label === "Updating…") return 1000;
  if (label.endsWith("just now")) return 1000;
  if (label.endsWith("s ago")) return 1000;
  if (label.endsWith("m ago")) return 60_000;
  if (label.endsWith("h ago")) return 3_600_000;
  return 86_400_000;
}

function usePortfolioFreshnessLabel({
  portfolioId,
  markovEnabled,
  waveEnabled,
  isFetching,
}: PortfolioFreshnessOptions): string | null {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      const next = computeFreshnessLabel(
        portfolioId,
        markovEnabled,
        waveEnabled,
        isFetching,
        queryClient,
        Date.now()
      );
      setLabel((prev) => (prev === next ? prev : next));
      timeoutId = setTimeout(refresh, freshnessTickMs(next));
    };

    refresh();
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [portfolioId, markovEnabled, waveEnabled, isFetching, queryClient]);

  return label;
}

export function PortfolioFreshnessLabel(props: PortfolioFreshnessOptions) {
  const label = usePortfolioFreshnessLabel(props);
  if (!label) return null;

  return (
    <span
      className="text-muted text-xs whitespace-nowrap"
      title="Time since portfolio prices and enrichment data were last refreshed"
    >
      {label}
    </span>
  );
}
