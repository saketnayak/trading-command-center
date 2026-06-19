from datetime import date, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.outcome import RunOutcome
from app.models.report import Report
from app.models.run import Run
from app.services.finnhub_client import (
    FinnhubCapability,
    fetch_json,
    get_finnhub_key,
)
from app.utils.asset_type import is_crypto
import app.services.crypto_data_service as _crypto
import app.services.yfinance_service as _yf
from app.services.quote_currency_service import resolve_quote_currency


async def _get_finnhub_key(db: AsyncSession) -> Optional[str]:
    return await get_finnhub_key(db)


async def _fetch_closing_price(symbol: str, target_date: date, api_key: Optional[str]) -> Optional[float]:
    if is_crypto(symbol):
        return await _crypto.fetch_historical_price(symbol, target_date, finnhub_key=api_key)

    if api_key:
        from datetime import datetime, timezone as tz
        # Fetch a 7-day window ending at target_date to catch weekends/holidays; take the last close.
        to_ts = int(datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59, tzinfo=tz.utc).timestamp())
        from_date = target_date - timedelta(days=7)
        from_ts = int(datetime(from_date.year, from_date.month, from_date.day, tzinfo=tz.utc).timestamp())
        raw, error = await fetch_json(
            "/stock/candle",
            api_key,
            FinnhubCapability.STOCK_CANDLE,
            params={
                "symbol": symbol,
                "resolution": "D",
                "from": from_ts,
                "to": to_ts,
            },
            timeout=10,
        )
        if error is None and isinstance(raw, dict) and raw.get("s") == "ok" and raw.get("c"):
            return float(raw["c"][-1])

    return await _yf.fetch_historical_close(symbol, target_date)


async def get_or_create_outcome(run_id: str, db: AsyncSession) -> RunOutcome:
    """Return outcome for run_id, lazily populating any past checkpoints that are missing."""
    from uuid import UUID
    run_uuid = UUID(run_id)

    run_result = await db.execute(select(Run).where(Run.id == run_uuid))
    run = run_result.scalar_one_or_none()
    if not run:
        raise ValueError(f"Run {run_id} not found")

    report_result = await db.execute(select(Report).where(Report.run_id == run_uuid))
    report = report_result.scalar_one_or_none()

    outcome_result = await db.execute(select(RunOutcome).where(RunOutcome.run_id == run_uuid))
    outcome = outcome_result.scalar_one_or_none()
    api_key = await _get_finnhub_key(db)

    if not outcome:
        price_currency = report.price_currency if report and report.price_currency else await resolve_quote_currency(
            run.ticker, db, api_key
        )
        outcome = RunOutcome(
            run_id=run_uuid,
            ticker=run.ticker,
            verdict=report.verdict if report else "unknown",
            analysis_date=str(run.analysis_date),
            price_currency=price_currency,
        )
        db.add(outcome)
        await db.flush()
    elif not outcome.price_currency or outcome.price_currency == "USD":
        if report and report.price_currency:
            outcome.price_currency = report.price_currency

    today = date.today()
    analysis_date = run.analysis_date
    if not isinstance(analysis_date, date):
        from datetime import datetime as dt
        analysis_date = dt.strptime(str(analysis_date), "%Y-%m-%d").date()

    needs_fetch = []
    if outcome.price_at_analysis is None and analysis_date <= today:
        needs_fetch.append(0)
    if outcome.price_7d is None and analysis_date + timedelta(days=7) <= today:
        needs_fetch.append(7)
    if outcome.price_14d is None and analysis_date + timedelta(days=14) <= today:
        needs_fetch.append(14)
    if outcome.price_30d is None and analysis_date + timedelta(days=30) <= today:
        needs_fetch.append(30)
    if outcome.price_90d is None and analysis_date + timedelta(days=90) <= today:
        needs_fetch.append(90)

    if needs_fetch:
        # Crypto uses CoinGecko first; stocks use Finnhub then Yahoo Finance.
        for days in needs_fetch:
            target = analysis_date + timedelta(days=days)
            price = await _fetch_closing_price(run.ticker, target, api_key)
            if days == 0:
                outcome.price_at_analysis = price
            elif days == 7:
                outcome.price_7d = price
            elif days == 14:
                outcome.price_14d = price
            elif days == 30:
                outcome.price_30d = price
            elif days == 90:
                outcome.price_90d = price

    # Always commit — covers both the new-row case (flush above needs a commit)
    # and the price-update case. No-op if nothing changed on an existing row.
    await db.commit()
    await db.refresh(outcome)

    return outcome
