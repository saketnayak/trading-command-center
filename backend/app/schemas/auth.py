from pydantic import BaseModel, EmailStr, Field


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


class UpdateMeRequest(BaseModel):
    name: str | None = None
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8)
    preferred_currency: str | None = None
