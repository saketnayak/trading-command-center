from __future__ import annotations

from typing import Any

import httpx


LOCAL_PROVIDER_IDS = frozenset({"ollama", "vllm", "litellm"})
OPENAI_COMPATIBLE_LOCAL_PROVIDER_IDS = frozenset({"vllm", "litellm"})

LOCAL_PROVIDER_DEFAULT_URLS: dict[str, str] = {
    "ollama": "http://localhost:11434",
    "vllm": "http://localhost:8080",
    "litellm": "http://localhost:4000",
}

LOCAL_PROVIDER_LABELS: dict[str, str] = {
    "ollama": "Ollama",
    "vllm": "vLLM",
    "litellm": "LiteLLM",
}


def is_local_provider(provider: str) -> bool:
    return provider in LOCAL_PROVIDER_IDS


def is_openai_compatible_local_provider(provider: str) -> bool:
    return provider in OPENAI_COMPATIBLE_LOCAL_PROVIDER_IDS


def normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def openai_compatible_base_url(base_url: str) -> str:
    normalized = normalize_base_url(base_url)
    if not normalized.endswith("/v1"):
        normalized += "/v1"
    return normalized


def chat_completions_url(provider: str, base_url: str) -> str:
    if provider == "ollama":
        return f"{normalize_base_url(base_url)}/v1/chat/completions"
    if is_openai_compatible_local_provider(provider):
        return f"{openai_compatible_base_url(base_url)}/chat/completions"
    raise ValueError(f"Unsupported local provider: {provider}")


def models_url(provider: str, base_url: str) -> str:
    if provider == "ollama":
        return f"{normalize_base_url(base_url)}/api/tags"
    if is_openai_compatible_local_provider(provider):
        return f"{openai_compatible_base_url(base_url)}/models"
    raise ValueError(f"Unsupported local provider: {provider}")


def parse_model_ids(provider: str, payload: dict[str, Any]) -> list[str]:
    if provider == "ollama":
        return [m["name"] for m in payload.get("models", []) if "name" in m]
    if is_openai_compatible_local_provider(provider):
        return [m["id"] for m in payload.get("data", []) if "id" in m]
    raise ValueError(f"Unsupported local provider: {provider}")


async def list_local_models(provider: str, base_url: str, client: httpx.AsyncClient) -> list[str]:
    response = await client.get(models_url(provider, base_url))
    response.raise_for_status()
    return parse_model_ids(provider, response.json())


async def validate_local_provider_url(provider: str, base_url: str, client: httpx.AsyncClient) -> bool:
    """Validate a local server URL.

    vLLM and LiteLLM deployments are not consistent about exposing /health, so
    model discovery is the fallback health check for OpenAI-compatible servers.
    """
    if provider == "ollama":
        response = await client.get(models_url(provider, base_url), timeout=5)
        return response.status_code == 200

    if not is_openai_compatible_local_provider(provider):
        return False

    normalized = normalize_base_url(base_url)
    try:
        health = await client.get(f"{normalized}/health", timeout=5)
        if health.status_code == 200:
            return True
    except Exception:
        pass

    try:
        models = await client.get(models_url(provider, base_url), timeout=5)
        return models.status_code == 200
    except Exception:
        return False
