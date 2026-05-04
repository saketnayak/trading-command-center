from pydantic import BaseModel, ConfigDict
from datetime import datetime


class ApiKeyUpsertRequest(BaseModel):
    provider: str
    key: str  # plaintext — encrypted before storage


class ApiKeyResponse(BaseModel):
    provider: str
    is_valid: bool
    validated_at: datetime | None
    masked_key: str  # first 4 + last 4 chars

    model_config = ConfigDict(from_attributes=True)
