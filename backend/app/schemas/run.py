from pydantic import BaseModel, ConfigDict
from datetime import date, datetime
from uuid import UUID


class RunCreateRequest(BaseModel):
    ticker: str
    analysis_date: date
    llm_provider: str
    llm_model: str
    depth: str  # quick|standard|deep
    analysts: list[str] = ["fundamentals", "sentiment", "news", "technical"]
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
    created_by: UUID
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)
