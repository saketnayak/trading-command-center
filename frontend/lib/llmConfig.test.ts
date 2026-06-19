import { describe, expect, it } from "vitest";
import {
  CLOUD_LLM_PROVIDERS,
  DEFAULT_LLM_DEPTH,
  DEFAULT_LLM_PROVIDER,
  LLM_PROVIDERS,
  LOCAL_LLM_PROVIDERS,
  llmConfigFromUserDefaults,
  resolveLlmModel,
  validateDefaultLlmConfig,
} from "./llmConfig";

const TEST_DEFAULT_MODELS = {
  openai: "gpt-5.5",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-3-flash-preview",
  groq: "llama-3.3-70b-versatile",
  ionos: "openai/gpt-oss-120b",
  ollama: "llama3",
  vllm: "mistralai/Mistral-7B-Instruct-v0.3",
} as const;

describe("llmConfig", () => {
  it("resolves blank model to provider default from API map", () => {
    expect(resolveLlmModel("openai", "", TEST_DEFAULT_MODELS)).toBe("gpt-5.5");
    expect(resolveLlmModel("ionos", "  ", TEST_DEFAULT_MODELS)).toBe("openai/gpt-oss-120b");
  });

  it("builds config from user defaults with fallbacks", () => {
    expect(llmConfigFromUserDefaults(null)).toEqual({
      provider: DEFAULT_LLM_PROVIDER,
      model: "",
      depth: DEFAULT_LLM_DEPTH,
    });
    expect(
      llmConfigFromUserDefaults({
        default_llm_provider: "groq",
        default_llm_model: "llama-3.3-70b-versatile",
        default_llm_depth: "quick",
      }),
    ).toEqual({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      depth: "quick",
    });
  });

  it("uses system defaults when user defaults are absent", () => {
    expect(
      llmConfigFromUserDefaults(null, {
        default_provider: "anthropic",
        default_depth: "deep",
      }),
    ).toEqual({
      provider: "anthropic",
      model: "",
      depth: "deep",
    });
  });

  it("validates default llm config", () => {
    expect(validateDefaultLlmConfig("openai", "gpt-5.5", "standard")).toBeNull();
    expect(validateDefaultLlmConfig("cohere", "x", "standard")).toMatch(/Unsupported provider/);
    expect(validateDefaultLlmConfig("openai", "x", "turbo")).toMatch(/Depth must be/);
  });

  it("derives cloud providers from the canonical provider list", () => {
    expect(CLOUD_LLM_PROVIDERS).toEqual(
      LLM_PROVIDERS.filter((provider) => !LOCAL_LLM_PROVIDERS.includes(provider)),
    );
    expect(CLOUD_LLM_PROVIDERS).not.toContain("ollama");
    expect(CLOUD_LLM_PROVIDERS).not.toContain("vllm");
  });
});
