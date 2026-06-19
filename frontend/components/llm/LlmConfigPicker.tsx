"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getProviderModels } from "@/lib/api";
import {
  LLM_DEPTHS,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  LOCAL_LLM_PROVIDERS,
  type LlmDepth,
  type LlmProvider,
} from "@/lib/llmConfig";
import { useLlmProviderDefaults } from "@/lib/useDefaultLlmConfig";

export interface LlmConfigValue {
  provider: LlmProvider;
  model: string;
  depth?: LlmDepth;
}

interface Props {
  value: LlmConfigValue;
  onChange: (value: LlmConfigValue) => void;
  showDepth?: boolean;
  layout?: "stacked" | "inline" | "compact";
  enabled?: boolean;
  className?: string;
  providerClassName?: string;
  modelClassName?: string;
  depthClassName?: string;
}

const INPUT_CLASS =
  "bg-input border border-input-border rounded-sm px-3 py-2 text-fg text-sm focus:outline-hidden focus:border-blue-600";
const COMPACT_INPUT_CLASS =
  "bg-input border border-input-border rounded-sm px-2 py-1.5 text-xs text-fg focus:outline-hidden focus:border-blue-500";

export function LlmConfigPicker({
  value,
  onChange,
  showDepth = false,
  layout = "stacked",
  enabled = true,
  className = "",
  providerClassName,
  modelClassName,
  depthClassName,
}: Props) {
  const isLocal = LOCAL_LLM_PROVIDERS.includes(value.provider);
  const inputClass = layout === "compact" ? COMPACT_INPUT_CLASS : INPUT_CLASS;
  const { data: providerDefaults } = useLlmProviderDefaults();
  const modelPlaceholder = providerDefaults?.default_models[value.provider] ?? "model name";

  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ["models", value.provider],
    queryFn: () => getProviderModels(value.provider),
    enabled,
    retry: false,
  });

  useEffect(() => {
    if (isLocal && models.length > 0 && !value.model) {
      onChange({ ...value, model: models[0] });
    }
  }, [models, isLocal, value.model, value.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleProviderChange(provider: LlmProvider) {
    onChange({ ...value, provider, model: "" });
  }

  const providerSelect = (
    <div className={layout === "inline" ? "space-y-1" : "mb-0"}>
      {layout !== "compact" && (
        <label className="block text-muted text-xs mb-1">LLM Provider</label>
      )}
      <select
        value={value.provider}
        onChange={(e) => handleProviderChange(e.target.value as LlmProvider)}
        disabled={!enabled}
        className={providerClassName ?? `${inputClass} w-full`}
      >
        {LLM_PROVIDERS.map((provider) => (
          <option key={provider} value={provider}>
            {layout === "compact" ? provider : LLM_PROVIDER_LABELS[provider]}
          </option>
        ))}
      </select>
    </div>
  );

  const modelControl = modelsLoading ? (
    <select disabled className={`${inputClass} w-full text-muted`}>
      <option>Loading models…</option>
    </select>
  ) : models.length > 0 ? (
    <select
      value={value.model}
      onChange={(e) => onChange({ ...value, model: e.target.value })}
      disabled={!enabled}
      className={modelClassName ?? `${inputClass} w-full`}
    >
      {models.map((model) => (
        <option key={model} value={model}>{model}</option>
      ))}
    </select>
  ) : (
    <>
      <input
        type="text"
        value={value.model}
        onChange={(e) => onChange({ ...value, model: e.target.value })}
        placeholder={modelPlaceholder}
        disabled={!enabled}
        className={modelClassName ?? `${inputClass} w-full`}
      />
      {isLocal && layout !== "compact" && (
        <p className="text-amber-400 text-xs mt-1">Server unreachable — enter model name manually</p>
      )}
    </>
  );

  const modelField = (
    <div className={layout === "inline" ? "space-y-1" : "mb-0"}>
      {layout !== "compact" && (
        <label className="block text-muted text-xs mb-1">LLM Model</label>
      )}
      {modelControl}
    </div>
  );

  const depthField = showDepth && (
    <div className={layout === "inline" ? "space-y-1" : "mb-0"}>
      {layout !== "compact" && (
        <label className="block text-muted text-xs mb-1">Research Depth</label>
      )}
      <select
        value={value.depth ?? "standard"}
        onChange={(e) => onChange({ ...value, depth: e.target.value as LlmDepth })}
        disabled={!enabled}
        className={depthClassName ?? `${inputClass} w-full`}
      >
        {LLM_DEPTHS.map((depth) => (
          <option key={depth} value={depth}>
            {layout === "compact" ? depth : (
              depth === "quick" ? "Quick — 1 debate round, faster"
                : depth === "standard" ? "Standard — 2 debate rounds"
                  : "Deep — 3 debate rounds, most thorough"
            )}
          </option>
        ))}
      </select>
    </div>
  );

  if (layout === "inline") {
    return (
      <div className={`flex flex-wrap items-end gap-3 ${className}`}>
        {providerSelect}
        {modelField}
        {depthField}
      </div>
    );
  }

  if (layout === "compact") {
    return (
      <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
        {providerSelect}
        {modelField}
        {depthField}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {providerSelect}
      {modelField}
      {depthField}
    </div>
  );
}
