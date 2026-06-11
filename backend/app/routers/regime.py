"""Single-ticker regime endpoint — not portfolio-scoped."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.markov_service import get_regime
from app.services.settings_service import get_app_settings

router = APIRouter()


@router.get("/regime/{ticker}")
async def get_ticker_regime(
    ticker: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return Markov regime analysis for a single ticker.
    Returns null if yfinance data is unavailable or computation fails.
    """
    settings = await get_app_settings(db)
    if not settings["enable_markov_regime"]:
        raise HTTPException(status_code=404, detail="Markov regime module is disabled")
    result = await get_regime(ticker.upper())
    return result  # FastAPI serialises None as JSON null
