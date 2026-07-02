"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortfolio, deletePortfolio, listPortfolios } from "@/lib/api";
import type { Portfolio } from "@/lib/types";
import {
  getLastPortfolioId,
  resolvePortfolioId,
  setLastPortfolioId,
} from "@/lib/portfolioSelection";
import { portfolioQueryKeys } from "@/lib/portfolioQueries";
import { PortfolioSwitcher } from "@/components/portfolio/PortfolioSwitcher";
import { TrendingPanel } from "@/components/portfolio/TrendingPanel";
import { DiscoverPanel } from "@/components/portfolio/DiscoverPanel";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader, PageTitle } from "@/components/layout/PageHeader";
import { TabBar, type TabBarItem } from "@/components/layout/TabBar";
import {
  DEFAULT_MARKET_TAB,
  MARKET_TAB_DEFINITIONS,
  resolveMarketTab,
  type MarketTab,
} from "@/lib/marketTabs";

function MarketPageContent() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [preferredPortfolioId, setPreferredPortfolioId] = useState<string | null>(
    () => getLastPortfolioId(),
  );

  const tab = useMemo(
    () => resolveMarketTab(searchParams.get("tab")),
    [searchParams],
  );

  const setTab = useCallback(
    (next: MarketTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_MARKET_TAB) {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const { data: portfolios = [], isLoading: loadingPortfolios } = useQuery({
    queryKey: portfolioQueryKeys.list,
    queryFn: listPortfolios,
  });

  const selectedPortfolioId = useMemo(
    () => resolvePortfolioId(portfolios, preferredPortfolioId),
    [portfolios, preferredPortfolioId],
  );

  const createMutation = useMutation({
    mutationFn: (name: string) => createPortfolio(name),
    onSuccess: (portfolio: Portfolio) => {
      queryClient.invalidateQueries({ queryKey: portfolioQueryKeys.list });
      setPreferredPortfolioId(portfolio.id);
      setLastPortfolioId(portfolio.id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePortfolio(id),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: portfolioQueryKeys.list });
      if (preferredPortfolioId === deletedId) {
        setPreferredPortfolioId(null);
      }
    },
  });

  useEffect(() => {
    if (selectedPortfolioId) {
      setLastPortfolioId(selectedPortfolioId);
    }
  }, [selectedPortfolioId]);

  const primaryTabs = useMemo<TabBarItem[]>(
    () =>
      MARKET_TAB_DEFINITIONS.map((def) => ({
        id: def.id,
        label: def.label,
        badge: def.badge,
      })),
    [],
  );

  return (
    <PageShell gap="4">
      <PageHeader title={<PageTitle>Market</PageTitle>} />

      <TabBar
        primaryTabs={primaryTabs}
        overflowTabs={[]}
        activeId={tab}
        onChange={(id) => setTab(id as MarketTab)}
      />

      {tab === "trending" && <TrendingPanel />}

      {tab === "discover" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              Stock ideas based on sector gaps in your portfolio.
            </p>
            {!loadingPortfolios && (
              <PortfolioSwitcher
                portfolios={portfolios}
                selectedId={selectedPortfolioId}
                onSelect={(id) => {
                  setPreferredPortfolioId(id);
                  setLastPortfolioId(id);
                }}
                onCreate={(name) => createMutation.mutate(name)}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            )}
          </div>

          {loadingPortfolios && (
            <p className="text-sm text-muted">Loading portfolios…</p>
          )}

          {!loadingPortfolios && portfolios.length === 0 && (
            <p className="text-muted text-sm text-center py-10">
              Create a portfolio first to use Discover recommendations.
            </p>
          )}

          {!loadingPortfolios && selectedPortfolioId && (
            <DiscoverPanel portfolioId={selectedPortfolioId} />
          )}
        </div>
      )}
    </PageShell>
  );
}

export default function MarketPage() {
  return (
    <Suspense
      fallback={
        <PageShell gap="4">
          <PageHeader title={<PageTitle>Market</PageTitle>} />
          <div className="text-muted text-sm">Loading…</div>
        </PageShell>
      }
    >
      <MarketPageContent />
    </Suspense>
  );
}
