"""Shared LLM provider constants and validation."""

from __future__ import annotations

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
    "litellm": "gpt-4o-mini",
}

SUPPORTED_LLM_PROVIDERS: frozenset[str] = frozenset(DEFAULT_LLM_MODELS.keys())
LOCAL_LLM_PROVIDERS: frozenset[str] = frozenset({"ollama", "vllm", "litellm"})
SUPPORTED_LLM_DEPTHS: frozenset[str] = frozenset({"quick", "standard", "deep"})

# Cloud provider model suggestions for /llm-providers/{provider}/models.
# Each list is de-duplicated with DEFAULT_LLM_MODELS[provider] first.
_PROVIDER_MODEL_OPTIONS: dict[str, list[str]] = {
    "openai": [
        "gpt-5.5", "gpt-5.5-pro",
        "gpt-5.4-mini", "gpt-5.4-nano",
        "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
        "o3-pro", "o3", "o4-mini",
        "gpt-4o", "gpt-4o-mini",
    ],
    "ionos": [
        "openai/gpt-oss-120b",
        "meta-llama/Meta-Llama-3.1-405B-Instruct-FP8",
        "meta-llama/Llama-3.3-70B-Instruct",
    ],
    "anthropic": [
        "claude-sonnet-4-6",
        "claude-opus-4-7", "claude-haiku-4-5-20251001",
        "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022",
    ],
    "google": [
        "gemini-3-flash-preview",
        "gemini-3.5-flash",
        "gemini-3.1-pro-preview",
        "gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview",
        "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
        "gemini-2.0-flash", "gemini-2.0-flash-lite",
    ],
    "groq": [
        "llama-3.3-70b-versatile",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "llama-3.1-8b-instant",
        "deepseek-r1-distill-llama-70b",
        "qwen-qwq-32b",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
        "compound-beta",
    ],
}


def _catalog_with_default_first(provider: str, models: list[str]) -> list[str]:
    default = DEFAULT_LLM_MODELS[provider]
    return [default, *[model for model in models if model != default]]


PROVIDER_MODEL_CATALOG: dict[str, list[str]] = {
    provider: _catalog_with_default_first(provider, models)
    for provider, models in _PROVIDER_MODEL_OPTIONS.items()
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
