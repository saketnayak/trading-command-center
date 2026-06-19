from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from datetime import date, datetime
from uuid import UUID

from app.utils.response_language import DEFAULT_RESPONSE_LANGUAGE, normalize_response_language
from app.utils.llm_providers import normalize_llm_depth, normalize_llm_provider, resolve_llm_model


class RunCreateRequest(BaseModel):
    ticker: str
    analysis_date: date
    llm_provider: str
    llm_model: str
    depth: str  # quick|standard|deep
    analysts: list[str] = ["market", "social", "news", "fundamentals"]
    response_language: str = DEFAULT_RESPONSE_LANGUAGE
    label: str | None = None

    @field_validator('depth')
    @classmethod
    def validate_depth(cls, v: str) -> str:
        return normalize_llm_depth(v)

    @field_validator('llm_provider')
    @classmethod
    def validate_llm_provider(cls, v: str) -> str:
        return normalize_llm_provider(v)

    @model_validator(mode="after")
    def resolve_model(self) -> "RunCreateRequest":
        self.llm_model = resolve_llm_model(self.llm_provider, self.llm_model)
        return self

    @field_validator('response_language')
    @classmethod
    def validate_response_language(cls, v: str | None) -> str:
        return normalize_response_language(v)


class RunResponse(BaseModel):
    id: UUID
    ticker: str
    analysis_date: date
    llm_provider: str
    llm_model: str
    depth: str
    analysts: list[str]
    response_language: str
    label: str | None
    notes: str | None = None
    status: str
    verdict: str | None
    archived: bool
    created_by: UUID
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    suggested_entry: str | None = None
    suggested_stop: str | None = None
    suggested_target: str | None = None
    price_currency: str | None = None

    model_config = ConfigDict(from_attributes=True)
