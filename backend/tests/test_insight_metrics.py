"""Measured performance/risk in the AI brief: the pure summary + prompt block,
and the runner end to end with the LLM and market data stubbed out."""
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.portfolio_insight import InsightStatus, InsightTrigger, PortfolioInsight
from app.services import insight_metrics, portfolio_insight_runner
from app.services.portfolio_insight_runner import _build_prompt
from tests.test_portfolio_performance import _client, _portfolio, _token
from tests.test_portfolio_risk import noisy_prices  # noqa: F401 - fixture

PERF = {
    "mode": "actual", "range": "1y", "start": "2026-01-02", "end": "2026-11-03", "benchmark": "SPY",
    "stats": {"total_return": 0.1871, "excess_return": 0.1173, "max_drawdown": -0.159},
    "benchmark_stats": {"total_return": 0.0698},
    "period_returns": {"1M": -0.0392, "3M": 0.0442, "1Y": None},
    "holdings": [
        {"ticker": "AAPL", "contribution": 0.1127},
        {"ticker": "MSFT", "contribution": 0.0882},
        {"ticker": "NVDA", "contribution": -0.0141},
    ],
}
RISK = {
    "lookback": "1y", "benchmark": "SPY", "warnings": [],
    "risk": {
        "stats": {"volatility": 0.207, "beta": 1.12, "var_95": 0.0202, "var_95_value": 380.5, "max_drawdown": -0.221},
        "concentration": {"effective_holdings": 3.7, "top1_weight": 0.35},
        "holdings": [
            {"ticker": "BTC-USD", "weight": 0.21, "risk_share": 0.31},
            {"ticker": "AAPL", "weight": 0.35, "risk_share": 0.21},
        ],
        "clusters": [{"tickers": ["NVDA", "AMD"], "combined_weight": 0.42, "average_correlation": 0.86}],
    },
    "stress": [
        {"name": "COVID crash", "portfolio_return": -0.38, "market_return": -0.339},
        {"name": "Global financial crisis", "portfolio_return": -0.62, "market_return": -0.568},
    ],
}


@pytest.mark.unit
def test_summary_keeps_the_decision_relevant_numbers():
    m = insight_metrics.summarize(PERF, RISK)
    assert m["performance"]["excess_return"] == 0.1173
    assert m["performance"]["period_returns"] == {"1M": -0.0392, "3M": 0.0442}
    # A holding that lost money is a detractor, never also a "contributor".
    assert [c["ticker"] for c in m["performance"]["top_contributors"]] == ["AAPL", "MSFT"]
    assert [c["ticker"] for c in m["performance"]["bottom_contributors"]] == ["NVDA"]
    assert [o["ticker"] for o in m["risk"]["risk_outliers"]] == ["BTC-USD"]
    assert m["risk"]["worst_stress"]["name"] == "Global financial crisis"
    assert insight_metrics.summarize(None, {"risk": None}) is None


@pytest.mark.unit
def test_prompt_block_quotes_measured_figures():
    block = insight_metrics.prompt_block(insight_metrics.summarize(PERF, RISK), "USD")
    assert "+18.7% vs SPY +7.0% (difference +11.7%)" in block
    assert "actual upload history" in block
    assert "volatility 20.7%/yr, beta 1.12 vs SPY" in block
    assert "1-day 95% VaR 2.0% (about 380 USD)" in block
    assert "BTC-USD is 21% of value but 31% of portfolio risk" in block
    assert "NVDA, AMD (average correlation 0.86, 42% of value)" in block
    assert "Global financial crisis → portfolio -62.0% (S&P 500 -56.8%)" in block
    assert insight_metrics.prompt_block(None, "USD") == ""


@pytest.mark.unit
def test_prompt_includes_block_and_instruction():
    prompt = _build_prompt("P", "2026-11-04", None, None, None, [], measured_block="\nMEASURED X\n")
    assert "MEASURED X" in prompt
    assert "never state a return, volatility or drawdown figure that is not in the data" in prompt
    assert "MEASURED X" not in _build_prompt("P", "2026-11-04", None, None, None, [])
    assert "MEASURED PERFORMANCE" not in _build_prompt("P", "2026-11-04", None, None, None, [])


async def test_runner_puts_measured_numbers_in_prompt_and_snapshot(noisy_prices, monkeypatch):  # noqa: F811
    async with _client() as client:
        headers = await _token(client, "brief@example.com")
        pid = await _portfolio(client, headers, [(1, {"TWIN1": 10, "TWIN2": 10, "CALM": 30})])

    seen: dict = {}

    async def _fake_llm(provider, model, key, prompt):
        seen["prompt"] = prompt
        return '{"health_score": 7, "overall_stance": "neutral", "summary": "ok", "action_items": [], ' \
               '"risk_alerts": [], "sector_analysis": {}, "strengths": [], "weaknesses": []}'

    async def _no_prices(tickers, key, db):
        return {}

    async def _sector(ticker, key):
        return "Tech"

    async def _no_regime(tickers):
        return {}

    async def _no_delivery(insight_id):
        return None

    import app.routers.portfolio as portfolio_router
    import app.services.delivery_service as delivery
    import app.services.markov_service as markov
    # The runner fires delivery as a background task; left running it races the
    # next test's TRUNCATE (deadlock), so stub it out.
    monkeypatch.setattr(delivery, "deliver_insight_if_configured", _no_delivery)
    monkeypatch.setattr(portfolio_insight_runner, "_call_llm", _fake_llm)
    monkeypatch.setattr(portfolio_insight_runner, "_fetch_sector", _sector)
    monkeypatch.setattr(portfolio_router, "_fetch_prices_bulk", _no_prices)
    monkeypatch.setattr(markov, "get_regime_for_portfolio", _no_regime)

    async with AsyncSessionLocal() as db:
        insight = PortfolioInsight(
            id=uuid.uuid4(), portfolio_id=uuid.UUID(pid), status=InsightStatus.pending,
            trigger=InsightTrigger.manual, llm_provider="ollama", llm_model="x",
            generated_at=datetime.now(timezone.utc),
        )
        db.add(insight)
        await db.commit()
        insight_id = str(insight.id)

    await portfolio_insight_runner.generate_portfolio_insight(insight_id)

    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(PortfolioInsight).where(PortfolioInsight.id == uuid.UUID(insight_id)))).scalar_one()
    assert row.status == InsightStatus.completed, row.error
    assert "MEASURED PERFORMANCE & RISK" in seen["prompt"]
    assert "Correlated cluster: TWIN" in seen["prompt"]
    measured = row.holdings_snapshot["measured"]
    assert measured["risk"]["volatility"] > 0
    assert measured["performance"]["mode"] == "current"  # one day of upload history → what-if
