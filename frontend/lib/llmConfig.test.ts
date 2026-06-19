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

describe("llmConfig", () => {
  it("resolves blank model to provider placeholder", () => {
    expect(resolveLlmModel("openai", "")).toBe("gpt-5.5");
    expect(resolveLlmModel("ionos", "  ")).toBe("openai/gpt-oss-120b");
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
