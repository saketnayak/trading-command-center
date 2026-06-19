import pytest
from app.utils.llm_providers import (
    DEFAULT_LLM_MODELS,
    normalize_llm_depth,
    normalize_llm_provider,
    resolve_llm_model,
)


def test_normalize_llm_provider_accepts_all_supported():
    for provider in DEFAULT_LLM_MODELS:
        assert normalize_llm_provider(provider) == provider
        assert normalize_llm_provider(provider.upper()) == provider


def test_normalize_llm_provider_rejects_unknown():
    with pytest.raises(ValueError, match="llm_provider"):
        normalize_llm_provider("cohere")


def test_resolve_llm_model_uses_provider_default_when_blank():
    assert resolve_llm_model("openai", "") == DEFAULT_LLM_MODELS["openai"]
    assert resolve_llm_model("ionos", "   ") == DEFAULT_LLM_MODELS["ionos"]


def test_normalize_llm_depth():
    assert normalize_llm_depth("QUICK") == "quick"
    with pytest.raises(ValueError):
        normalize_llm_depth("turbo")
