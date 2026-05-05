from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str = "postgresql://agentfloor:agentfloor@localhost:5432/agentfloor"
    jwt_secret: str = "dev-secret-change-in-production"
    encryption_key: str = "0" * 64
    google_client_id: str = ""
    google_client_secret: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@agentfloor.local"
    frontend_url: str = "http://localhost:3000"
    run_timeout_seconds: int = 3600

settings = Settings()
