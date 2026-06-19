export const LLM_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "ionos",
  "ollama",
  "vllm",
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const LOCAL_LLM_PROVIDERS: readonly LlmProvider[] = ["ollama", "vllm"];

export const LLM_DEPTHS = ["quick", "standard", "deep"] as const;
export type LlmDepth = (typeof LLM_DEPTHS)[number];

export const DEFAULT_LLM_PROVIDER: LlmProvider = "openai";
export const DEFAULT_LLM_DEPTH: LlmDepth = "standard";

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  groq: "Groq",
  ionos: "IONOS",
  ollama: "Ollama (local)",
  vllm: "vLLM (local)",
};

export const LLM_PROVIDER_PLACEHOLDERS: Record<LlmProvider, string> = {
  openai: "gpt-5.5",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-3-flash-preview",
  groq: "llama-3.3-70b-versatile",
  ionos: "openai/gpt-oss-120b",
  ollama: "llama3",
  vllm: "mistralai/Mistral-7B-Instruct-v0.3",
};

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  depth?: LlmDepth;
}

export interface UserDefaultLlmConfig {
  default_llm_provider: string;
  default_llm_model: string | null;
  default_llm_depth: string;
}

export function isLlmProvider(value: string): value is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

export function isLlmDepth(value: string): value is LlmDepth {
  return (LLM_DEPTHS as readonly string[]).includes(value);
}

export function resolveLlmModel(provider: LlmProvider, model: string): string {
  const trimmed = model.trim();
  return trimmed || LLM_PROVIDER_PLACEHOLDERS[provider];
}

export function llmConfigFromUserDefaults(
  defaults?: Partial<UserDefaultLlmConfig> | null,
): LlmConfig {
  const provider = defaults?.default_llm_provider && isLlmProvider(defaults.default_llm_provider)
    ? defaults.default_llm_provider
    : DEFAULT_LLM_PROVIDER;
  const model = defaults?.default_llm_model?.trim() ?? "";
  const depth = defaults?.default_llm_depth && isLlmDepth(defaults.default_llm_depth)
    ? defaults.default_llm_depth
    : DEFAULT_LLM_DEPTH;
  return { provider, model, depth };
}

export function validateDefaultLlmConfig(
  provider: string,
  model: string,
  depth: string,
): string | null {
  if (!isLlmProvider(provider)) {
    return `Unsupported provider: ${provider}`;
  }
  if (!isLlmDepth(depth)) {
    return "Depth must be quick, standard, or deep";
  }
  if (model.trim().length > 128) {
    return "Model name must be at most 128 characters";
  }
  return null;
}
