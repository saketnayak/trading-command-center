"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildPortfolioSyncQueryKeys,
  type PortfolioTab,
} from "@/lib/portfolioQueries";

interface UsePortfolioSyncOptions {
  portfolioId: string | null;
  activeTab: PortfolioTab;
  markovEnabled: boolean;
  waveEnabled: boolean;
  onMetadataForceRefresh?: () => void;
}

interface UsePortfolioSyncResult {
  syncAll: () => Promise<void>;
  isSyncing: boolean;
}

export function usePortfolioSync({
  portfolioId,
  activeTab,
  markovEnabled,
  waveEnabled,
  onMetadataForceRefresh,
}: UsePortfolioSyncOptions): UsePortfolioSyncResult {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);

  const syncAll = useCallback(async () => {
    if (!portfolioId || isSyncing) return;

    setIsSyncing(true);
    try {
      onMetadataForceRefresh?.();

      const keys = buildPortfolioSyncQueryKeys({
        portfolioId,
        activeTab,
        markovEnabled,
        waveEnabled,
      });

      await Promise.all(
        keys.map((queryKey) =>
          queryClient.refetchQueries({ queryKey, type: "active" })
        )
      );

      await queryClient.refetchQueries({
        queryKey: ["ticker-metadata"],
        type: "active",
      });
    } finally {
      setIsSyncing(false);
    }
  }, [
    portfolioId,
    activeTab,
    markovEnabled,
    waveEnabled,
    isSyncing,
    onMetadataForceRefresh,
    queryClient,
  ]);

  return { syncAll, isSyncing };
}
