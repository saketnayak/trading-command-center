"use client";

import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/api";
import {
  DEFAULT_LLM_DEPTH,
  DEFAULT_LLM_PROVIDER,
  llmConfigFromUserDefaults,
  type LlmConfig,
  type LlmDepth,
  type LlmProvider,
} from "@/lib/llmConfig";

export function useDefaultLlmConfig() {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 60_000,
  });

  const config = llmConfigFromUserDefaults(me);

  return {
    isLoading,
    provider: config.provider as LlmProvider,
    model: config.model,
    depth: (config.depth ?? DEFAULT_LLM_DEPTH) as LlmDepth,
    config: config as LlmConfig,
    me,
  };
}

export { DEFAULT_LLM_PROVIDER, DEFAULT_LLM_DEPTH };
