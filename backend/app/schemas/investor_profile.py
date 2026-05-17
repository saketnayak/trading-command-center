from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime
from typing import Optional


class InvestorProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]
    income_range: Optional[str]
    liquidity_reserve: Optional[str]
    dependents: Optional[int]
    time_horizon: Optional[str]
    risk_willingness: Optional[int]
    risk_ability: Optional[str]
    investment_style: Optional[str]
    sizing_approach: Optional[str]
    preferred_sectors: Optional[list[str]]
    blind_spots: Optional[str]
    emotional_tendencies: Optional[str]
    personal_rules: Optional[str]
    anti_portfolio: Optional[list[str]]
    target_portfolio_size: Optional[str]
    income_goal: Optional[str]
    milestones: Optional[str]


class InvestorProfileUpsertRequest(BaseModel):
    income_range: Optional[str] = None
    liquidity_reserve: Optional[str] = None
    dependents: Optional[int] = None
    time_horizon: Optional[str] = None
    risk_willingness: Optional[int] = None
    risk_ability: Optional[str] = None
    investment_style: Optional[str] = None
    sizing_approach: Optional[str] = None
    preferred_sectors: Optional[list[str]] = None
    blind_spots: Optional[str] = None
    emotional_tendencies: Optional[str] = None
    personal_rules: Optional[str] = None
    anti_portfolio: Optional[list[str]] = None
    target_portfolio_size: Optional[str] = None
    income_goal: Optional[str] = None
    milestones: Optional[str] = None
