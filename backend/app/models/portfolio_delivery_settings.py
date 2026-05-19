import uuid
from datetime import datetime
from typing import Optional

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


class PortfolioDeliverySettings(Base):
    __tablename__ = "portfolio_delivery_settings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    portfolio_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("portfolios.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(server_default=sa.func.now())
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        onupdate=sa.func.now(), nullable=True
    )

    email_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, server_default=sa.false(), nullable=False
    )
    email_address: Mapped[Optional[str]] = mapped_column(sa.String(255), nullable=True)

    webhook_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, server_default=sa.false(), nullable=False
    )
    webhook_url: Mapped[Optional[str]] = mapped_column(sa.Text, nullable=True)
    webhook_format: Mapped[str] = mapped_column(
        sa.String(16), default="json", server_default="json", nullable=False
    )
    telegram_chat_id: Mapped[Optional[str]] = mapped_column(sa.String(64), nullable=True)
