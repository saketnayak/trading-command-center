from typing import Any

from pydantic import BaseModel, ConfigDict
from datetime import datetime


class FinnhubCapabilityStatusResponse(BaseModel):
    ok: bool
    reason: str | None = None
    message: str | None = None


class ApiKeyUpsertRequest(BaseModel):
    provider: str
    key: str  # plaintext — encrypted before storage


class ApiKeyResponse(BaseModel):
    provider: str
    is_valid: bool
    validated_at: datetime | None
    masked_key: str | None  # None when key was encrypted with a different ENCRYPTION_KEY
    capabilities: dict[str, FinnhubCapabilityStatusResponse] | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None
    capabilities_checked_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
