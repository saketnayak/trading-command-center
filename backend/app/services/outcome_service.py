from datetime import date, timedelta
from typing import Optional
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.api_key import ApiKey
from app.models.outcome import RunOutcome
from app.models.report import Report
from app.models.run import Run
from app.services.encryption import decrypt_key


async def _get_alpha_vantage_key(db: AsyncSession) -> Optional[str]:
    result = await db.execute(select(ApiKey).where(ApiKey.provider == "alpha_vantage"))
    key_row = result.scalar_one_or_none()
    if not key_row or not key_row.is_valid:
        return None
    return decrypt_key(key_row.encrypted_key)


async def _fetch_closing_price(symbol: str, target_date: date, api_key: str) -> Optional[float]:
    url = (
        f"https://www.alphavantage.co/query"
        f"?function=TIME_SERIES_DAILY&symbol={symbol}&outputsize=full&apikey={api_key}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()
        series = data.get("Time Series (Daily)", {})
        # Walk back up to 5 days to handle weekends/holidays
        for offset in range(5):
            key = str(target_date - timedelta(days=offset))
            if key in series:
                return float(series[key]["4. close"])
    except Exception:
        pass
    return None


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
    if not outcome:
        outcome = RunOutcome(
            run_id=run_uuid,
            ticker=run.ticker,
            verdict=report.verdict if report else "unknown",
            analysis_date=str(run.analysis_date),
        )
        db.add(outcome)
        await db.flush()

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
        api_key = await _get_alpha_vantage_key(db)
        if api_key:
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
        await db.commit()
        await db.refresh(outcome)

    return outcome
