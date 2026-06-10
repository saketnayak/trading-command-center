from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class KalmanSettings(Base):
    __tablename__ = "kalman_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    observation_covariance: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.1")
    transition_covariance: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.01")
    processing_mode: Mapped[str] = mapped_column(String(16), nullable=False, server_default="causal")
    updated_at = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
