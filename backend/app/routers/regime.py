"""Single-ticker regime endpoint — not portfolio-scoped."""
from fastapi import APIRouter, Depends
from app.services.markov_service import get_regime
from app.dependencies import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("/regime/{ticker}")
async def get_ticker_regime(ticker: str, user: User = Depends(get_current_user)):
    """Return Markov regime analysis for a single ticker.
    Returns null if yfinance data is unavailable or computation fails.
    """
    result = await get_regime(ticker.upper())
    return result  # FastAPI serialises None as JSON null
