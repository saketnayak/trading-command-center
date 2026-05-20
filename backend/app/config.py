from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_JWT = "dev-secret-change-in-production"
_INSECURE_ENC = "0" * 64


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql://agentfloor:agentfloor@localhost:5432/agentfloor"
    jwt_secret: str = _INSECURE_JWT
    encryption_key: str = _INSECURE_ENC
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@agentfloor.local"
    frontend_url: str = "http://localhost:3000"
    run_timeout_seconds: int = 3600
    disable_registration: bool = False

    @model_validator(mode="after")
    def validate_secrets(self) -> "Settings":
        if self.jwt_secret == _INSECURE_JWT:
            raise ValueError(
                "JWT_SECRET is set to the insecure default. "
                "Generate a secret with: openssl rand -hex 32"
            )
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters.")
        if self.encryption_key == _INSECURE_ENC:
            raise ValueError(
                "ENCRYPTION_KEY is set to the insecure default. "
                "Generate one with: openssl rand -hex 32"
            )
        try:
            decoded = bytes.fromhex(self.encryption_key)
        except ValueError:
            raise ValueError("ENCRYPTION_KEY must be a valid hex string.")
        if len(decoded) != 32:
            raise ValueError("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).")
        return self


settings = Settings()
