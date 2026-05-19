from typing import Literal, Optional

from pydantic import BaseModel, field_validator


class DeliverySettingsResponse(BaseModel):
    email_enabled: bool
    email_address: Optional[str]
    webhook_enabled: bool
    webhook_url: Optional[str]
    webhook_format: Literal["json", "slack", "telegram"]
    telegram_chat_id: Optional[str]

    model_config = {"from_attributes": True}


class UpdateDeliverySettingsRequest(BaseModel):
    email_enabled: Optional[bool] = None
    email_address: Optional[str] = None
    webhook_enabled: Optional[bool] = None
    webhook_url: Optional[str] = None
    webhook_format: Optional[Literal["json", "slack", "telegram"]] = None
    telegram_chat_id: Optional[str] = None

    @field_validator("webhook_url")
    @classmethod
    def webhook_url_must_be_https(cls, v: Optional[str]) -> Optional[str]:
        if v and not v.startswith("https://"):
            raise ValueError("webhook_url must start with https://")
        return v
