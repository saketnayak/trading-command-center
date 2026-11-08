"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getFxRates, getMe, updateProfile } from "@/lib/api";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import type { User } from "@/lib/types";

export const FX_RATES_QUERY_KEY = ["fx-rates"] as const;

/** The currency Portfolio and Net worth show money in: the user's saved preference, switched in one click.
 * `ready` is false until the profile loads, so money queries can wait instead of fetching twice. */
export function useDisplayCurrency() {
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: 60_000 });
  const { data: fx } = useQuery({ queryKey: FX_RATES_QUERY_KEY, queryFn: () => getFxRates(), staleTime: 5 * 60_000 });
  const [saveError, setSaveError] = useState(false);

  const setCurrency = useCallback(
    (code: string) => {
      const next = code.toUpperCase();
      queryClient.setQueryData<User>(["me"], (prev) => (prev ? { ...prev, preferred_currency: next } : prev));
      setSaveError(false);
      updateProfile({ preferred_currency: next }).catch(() => setSaveError(true));
    },
    [queryClient],
  );

  return {
    currency: (me?.preferred_currency ?? "USD").toUpperCase(),
    ready: me != null,
    setCurrency,
    saveError,
    supported: fx?.supported ?? [...SUPPORTED_CURRENCIES],
  };
}
