from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    name: str
    role: str
    created_at: datetime


class UserUpdateRequest(BaseModel):
    role: str  # admin|member
