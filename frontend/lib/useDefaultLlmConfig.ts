"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLlmProviderDefaults, getMe } from "@/lib/api";
import {
  DEFAULT_LLM_DEPTH,
  DEFAULT_LLM_PROVIDER,
  llmConfigFromUserDefaults,
  resolveLlmModel,
  type LlmConfig,
  type LlmDepth,
  type LlmProvider,
} from "@/lib/llmConfig";

export const LLM_PROVIDER_DEFAULTS_QUERY_KEY = ["llm-provider-defaults"] as const;

export function useLlmProviderDefaults() {
  return useQuery({
    queryKey: LLM_PROVIDER_DEFAULTS_QUERY_KEY,
    queryFn: getLlmProviderDefaults,
    staleTime: 300_000,
  });
}

export function useDefaultLlmConfig() {
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 60_000,
  });
  const { data: systemDefaults, isLoading: defaultsLoading } = useLlmProviderDefaults();

  const defaultModels = (systemDefaults?.default_models ?? {}) as Partial<Record<LlmProvider, string>>;
  const config = llmConfigFromUserDefaults(me, systemDefaults);

  const resolveModel = useCallback(
    (value: { provider: LlmProvider; model: string }) =>
      resolveLlmModel(value.provider, value.model, defaultModels),
    [defaultModels],
  );

  return {
    isLoading: meLoading || defaultsLoading,
    provider: config.provider as LlmProvider,
    model: config.model,
    depth: (config.depth ?? DEFAULT_LLM_DEPTH) as LlmDepth,
    config: config as LlmConfig,
    me,
    defaultModels,
    resolveModel,
  };
}

export { DEFAULT_LLM_PROVIDER, DEFAULT_LLM_DEPTH };
