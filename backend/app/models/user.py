import uuid, enum
from datetime import datetime
from sqlalchemy import String, Enum as SAEnum, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.base import Base

class UserRole(str, enum.Enum):
    admin = "admin"
    member = "member"

class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str] = mapped_column(String)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), default=UserRole.member)
    google_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    preferred_currency: Mapped[str] = mapped_column(String(8), server_default="USD")
    default_llm_provider: Mapped[str] = mapped_column(String(32), server_default="openai")
    default_llm_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    default_llm_depth: Mapped[str] = mapped_column(String(16), server_default="standard")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    investor_profile: Mapped["InvestorProfile | None"] = relationship(
        "InvestorProfile", back_populates="user", uselist=False
    )
