from pydantic import BaseModel, EmailStr, Field, field_validator

from app.utils.llm_providers import (
    DEFAULT_LLM_DEPTH,
    DEFAULT_LLM_PROVIDER,
    normalize_llm_depth,
    normalize_llm_model,
    normalize_llm_provider,
    resolve_llm_model,
)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str
    invite_token: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class InviteRequest(BaseModel):
    email: EmailStr


class DefaultLlmConfig(BaseModel):
    provider: str = DEFAULT_LLM_PROVIDER
    model: str | None = None
    depth: str = DEFAULT_LLM_DEPTH

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, v: str) -> str:
        return normalize_llm_provider(v)

    @field_validator("model")
    @classmethod
    def validate_model(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        if not stripped:
            return None
        return normalize_llm_model(stripped)

    @field_validator("depth")
    @classmethod
    def validate_depth(cls, v: str) -> str:
        return normalize_llm_depth(v)

    def resolved_model(self) -> str:
        return resolve_llm_model(self.provider, self.model)


class UpdateMeRequest(BaseModel):
    name: str | None = None
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8)
    preferred_currency: str | None = None
    default_llm_provider: str | None = None
    default_llm_model: str | None = None
    default_llm_depth: str | None = None

    @field_validator("default_llm_provider")
    @classmethod
    def validate_default_llm_provider(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return normalize_llm_provider(v)

    @field_validator("default_llm_model")
    @classmethod
    def validate_default_llm_model(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        if not stripped:
            return None
        return normalize_llm_model(stripped)

    @field_validator("default_llm_depth")
    @classmethod
    def validate_default_llm_depth(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return normalize_llm_depth(v)
