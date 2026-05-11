from pydantic import BaseModel, ConfigDict
from datetime import datetime


class ApiKeyUpsertRequest(BaseModel):
    provider: str
    key: str  # plaintext — encrypted before storage


class ApiKeyResponse(BaseModel):
    provider: str
    is_valid: bool
    validated_at: datetime | None
    masked_key: str | None  # None when key was encrypted with a different ENCRYPTION_KEY

    model_config = ConfigDict(from_attributes=True)
