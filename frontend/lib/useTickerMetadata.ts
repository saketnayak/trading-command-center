"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTickerMetadata } from "@/lib/api";
import type { TickerMetadata } from "@/lib/types";

export const TICKER_METADATA_STALE_TIME = 24 * 60 * 60 * 1000;

export function normalizeTickerList(tickers: readonly string[]): string[] {
  return Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))
  )
    .sort()
    .slice(0, 50);
}

interface UseTickerMetadataOptions {
  enabled?: boolean;
  forceRefresh?: boolean;
}

export function useTickerMetadata(
  tickers: readonly string[],
  options: UseTickerMetadataOptions = {}
) {
  const normalizedTickers = useMemo(() => normalizeTickerList(tickers), [tickers]);
  const queryKey = useMemo(
    () => ["ticker-metadata", normalizedTickers, options.forceRefresh ?? false] as const,
    [normalizedTickers, options.forceRefresh]
  );

  return useQuery<Record<string, TickerMetadata>>({
    queryKey,
    queryFn: async () => {
      const response = await getTickerMetadata(normalizedTickers, {
        forceRefresh: options.forceRefresh,
      });
      return response.items;
    },
    enabled: (options.enabled ?? true) && normalizedTickers.length > 0,
    staleTime: TICKER_METADATA_STALE_TIME,
  });
}
