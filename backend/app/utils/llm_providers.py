"""Shared LLM provider constants and validation."""

from __future__ import annotations

SUPPORTED_LLM_PROVIDERS: frozenset[str] = frozenset({
    "openai", "anthropic", "google", "groq", "ionos", "ollama", "vllm",
})
LOCAL_LLM_PROVIDERS: frozenset[str] = frozenset({"ollama", "vllm"})
SUPPORTED_LLM_DEPTHS: frozenset[str] = frozenset({"quick", "standard", "deep"})

DEFAULT_LLM_PROVIDER = "openai"
DEFAULT_LLM_DEPTH = "standard"
MAX_LLM_MODEL_LENGTH = 128

DEFAULT_LLM_MODELS: dict[str, str] = {
    "openai": "gpt-5.5",
    "anthropic": "claude-sonnet-4-6",
    "google": "gemini-3-flash-preview",
    "groq": "llama-3.3-70b-versatile",
    "ionos": "openai/gpt-oss-120b",
    "ollama": "llama3",
    "vllm": "mistralai/Mistral-7B-Instruct-v0.3",
}


def normalize_llm_provider(provider: str) -> str:
    normalized = provider.strip().lower()
    if normalized not in SUPPORTED_LLM_PROVIDERS:
        supported = ", ".join(sorted(SUPPORTED_LLM_PROVIDERS))
        raise ValueError(f"llm_provider must be one of: {supported}")
    return normalized


def normalize_llm_model(model: str) -> str:
    normalized = model.strip()
    if not normalized:
        raise ValueError("llm_model is required")
    if len(normalized) > MAX_LLM_MODEL_LENGTH:
        raise ValueError(f"llm_model must be at most {MAX_LLM_MODEL_LENGTH} characters")
    return normalized


def normalize_llm_depth(depth: str) -> str:
    normalized = depth.strip().lower()
    if normalized not in SUPPORTED_LLM_DEPTHS:
        raise ValueError("depth must be one of: quick, standard, deep")
    return normalized


def resolve_llm_model(provider: str, model: str | None) -> str:
    provider = normalize_llm_provider(provider)
    if model and model.strip():
        return normalize_llm_model(model)
    return DEFAULT_LLM_MODELS[provider]
