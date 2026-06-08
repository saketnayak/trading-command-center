import pytest
from pydantic import ValidationError

from app.schemas.run import RunCreateRequest
from app.utils.response_language import DEFAULT_RESPONSE_LANGUAGE, normalize_response_language

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("language", ["en-US", "zh-TW", "zh-CN", "ja-JP", "ko-KR", "de-DE"])
def test_normalize_response_language_accepts_supported_values(language):
    assert normalize_response_language(language) == language


@pytest.mark.parametrize("language", [None, "", "   "])
def test_normalize_response_language_defaults_blank_values(language):
    assert normalize_response_language(language) == DEFAULT_RESPONSE_LANGUAGE


def test_normalize_response_language_rejects_unsupported_values():
    with pytest.raises(ValueError, match="response_language must be one of"):
        normalize_response_language("fr-FR")


def test_run_create_request_defaults_response_language():
    req = RunCreateRequest(
        ticker="AAPL",
        analysis_date="2026-05-31",
        llm_provider="openai",
        llm_model="gpt-5.5",
        depth="standard",
    )

    assert req.response_language == DEFAULT_RESPONSE_LANGUAGE


def test_run_create_request_rejects_invalid_response_language():
    with pytest.raises(ValidationError):
        RunCreateRequest(
            ticker="AAPL",
            analysis_date="2026-05-31",
            llm_provider="openai",
            llm_model="gpt-5.5",
            depth="standard",
            response_language="fr-FR",
        )
