import type { QueryClient } from "@tanstack/react-query";
import {
  listPortfolios,
  getPortfolioCurrent,
  getPortfolioFundamentals,
  getPortfolioRegime,
  getPortfolioWave,
  getPortfolioTrimSignals,
  getBehavioralAlerts,
  getAppSettings,
} from "@/lib/api";
import { portfolioQueryKeys, PORTFOLIO_STALE_TIMES } from "@/lib/portfolioQueries";
import { getLastPortfolioId, resolvePortfolioId } from "@/lib/portfolioSelection";
import type { Portfolio } from "@/lib/types";

let prefetchInFlight: Promise<void> | null = null;

export async function prefetchPortfolioData(queryClient: QueryClient): Promise<void> {
  if (prefetchInFlight) return prefetchInFlight;

  prefetchInFlight = runPrefetch(queryClient).finally(() => {
    prefetchInFlight = null;
  });
  return prefetchInFlight;
}

async function runPrefetch(queryClient: QueryClient): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: portfolioQueryKeys.list,
    queryFn: listPortfolios,
  });

  const portfolios = queryClient.getQueryData<Portfolio[]>(portfolioQueryKeys.list) ?? [];
  const portfolioId = resolvePortfolioId(portfolios, getLastPortfolioId());
  if (!portfolioId) return;

  let markovEnabled = true;
  let waveEnabled = true;
  try {
    const settings = await queryClient.fetchQuery({
      queryKey: ["app-settings"],
      queryFn: getAppSettings,
      staleTime: 60_000,
    });
    markovEnabled = settings.enableMarkovRegime !== false;
    waveEnabled = settings.enableElliottWave !== false;
  } catch {
    // Prefetch enrichment with defaults when settings are unavailable.
  }

  const prefetches: Array<Promise<void>> = [
    queryClient.prefetchQuery({
      queryKey: portfolioQueryKeys.current(portfolioId),
      queryFn: () => getPortfolioCurrent(portfolioId),
      staleTime: PORTFOLIO_STALE_TIMES.current,
    }),
    queryClient.prefetchQuery({
      queryKey: portfolioQueryKeys.fundamentals(portfolioId),
      queryFn: () => getPortfolioFundamentals(portfolioId),
      staleTime: PORTFOLIO_STALE_TIMES.fundamentals,
    }),
    queryClient.prefetchQuery({
      queryKey: portfolioQueryKeys.behavioralAlerts(portfolioId),
      queryFn: () => getBehavioralAlerts(portfolioId),
      staleTime: PORTFOLIO_STALE_TIMES.behavioralAlerts,
    }),
  ];

  if (markovEnabled) {
    prefetches.push(
      queryClient.prefetchQuery({
        queryKey: portfolioQueryKeys.regime(portfolioId),
        queryFn: () => getPortfolioRegime(portfolioId),
        staleTime: PORTFOLIO_STALE_TIMES.regime,
      }),
      queryClient.prefetchQuery({
        queryKey: portfolioQueryKeys.trimSignals(portfolioId),
        queryFn: () => getPortfolioTrimSignals(portfolioId),
        staleTime: PORTFOLIO_STALE_TIMES.trimSignals,
      })
    );
  }

  if (waveEnabled) {
    prefetches.push(
      queryClient.prefetchQuery({
        queryKey: portfolioQueryKeys.wave(portfolioId),
        queryFn: () => getPortfolioWave(portfolioId),
        staleTime: PORTFOLIO_STALE_TIMES.wave,
      })
    );
  }

  await Promise.all(prefetches);
}
