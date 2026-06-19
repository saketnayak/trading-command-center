"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchPortfolioData } from "@/lib/prefetchPortfolioData";

const PORTFOLIO_PATH = "/portfolio";

export function usePortfolioPrefetch() {
  const queryClient = useQueryClient();
  const pathname = usePathname();

  return useCallback(() => {
    if (pathname === PORTFOLIO_PATH) return;
    void prefetchPortfolioData(queryClient);
  }, [pathname, queryClient]);
}
