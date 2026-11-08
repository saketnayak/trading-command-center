"""Exchange rates for the display-currency picker: the current snapshot, its source and age."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_current_user, normalize_currency
from app.models.user import User
from app.services import fx_service

router = APIRouter()


@router.get("/fx/rates")
async def fx_rates(base: str = Query("USD", max_length=8), user: User = Depends(get_current_user)):
    try:
        base = normalize_currency(base, "USD")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    snap = await fx_service.snapshot()
    rates = {}
    for code in sorted(fx_service.SUPPORTED_CURRENCIES):
        rate = snap.convert(base, code)
        if rate is not None:
            rates[code] = rate
    return {
        "base": base,
        "rates": rates,
        "source": snap.source,
        "as_of": snap.as_of.isoformat() if snap.as_of else None,
        "supported": sorted(fx_service.SUPPORTED_CURRENCIES),
    }
