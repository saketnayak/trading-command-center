from pydantic import BaseModel, ConfigDict
from datetime import date, datetime
from uuid import UUID


class RunCreateRequest(BaseModel):
    ticker: str
    analysis_date: date
    llm_provider: str
    llm_model: str
    depth: str  # quick|standard|deep
    analysts: list[str] = ["market", "social", "news", "fundamentals", "technical"]
    label: str | None = None


class RunResponse(BaseModel):
    id: UUID
    ticker: str
    analysis_date: date
    llm_provider: str
    llm_model: str
    depth: str
    analysts: list[str]
    label: str | None
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

    model_config = ConfigDict(from_attributes=True)
