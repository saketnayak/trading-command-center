from sqlalchemy import Boolean, DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class AppSettings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    observation_covariance: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.1")
    transition_covariance: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.01")
    processing_mode: Mapped[str] = mapped_column(String(16), nullable=False, server_default="causal")
    enable_kalman_filter: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    enable_elliott_wave: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    enable_markov_regime: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    updated_at = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
