"""FX factors for the report endpoints: a symbol with no rate is left out, never counted 1:1."""
from datetime import datetime, timedelta, timezone

import pytest

from app.database import AsyncSessionLocal
from app.models.ticker_metadata import TickerMetadata
from app.services.portfolio_pricing import fx_factors, no_rate_warning, without_rate


async def _meta(db, ticker: str, currency: str) -> None:
    now = datetime.now(timezone.utc)
    db.add(TickerMetadata(ticker=ticker, currency=currency, fetched_at=now, expires_at=now + timedelta(days=1)))


async def test_fx_factors_omits_symbols_without_a_rate(fixed_fx):
    fixed_fx({"USD": 1.0, "AUD": 1.5})
    async with AsyncSessionLocal() as db:
        await _meta(db, "AAPL", "USD")
        await _meta(db, "CSL.AX", "AUD")
        await _meta(db, "NOVN.SW", "CHF")
        await db.commit()
        fx, ccys = await fx_factors(db, ["AAPL", "CSL.AX", "NOVN.SW"], "AUD")
    assert fx == {"AAPL": 1.5, "CSL.AX": 1.0} and ccys["NOVN.SW"] == "CHF"
    assert without_rate(["NOVN.SW", "AAPL", "CSL.AX"], fx) == ["NOVN.SW"]


@pytest.mark.unit
def test_no_rate_warning_text():
    assert no_rate_warning(["NOVN.SW", "ROG.SW"], "AUD") == "No AUD exchange rate for NOVN.SW, ROG.SW; left out."
