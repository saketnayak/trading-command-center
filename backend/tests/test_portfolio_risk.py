"""Integration tests for GET /portfolio/{id}/risk (yfinance faked; no network)."""
import zlib
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pytest

from app.services import price_history_service
from tests.test_portfolio_performance import _client, _portfolio, _token

TODAY = datetime.now(timezone.utc).date()
# (drift, volatility, how much of the market factor) per symbol
PROFILE = {
    "SPY": (0.0004, 0.010, 1.0),
    "TWIN1": (0.0006, 0.004, 1.6),
    "TWIN2": (0.0006, 0.004, 1.6),
    "CALM": (0.0002, 0.003, 0.2),
}


@pytest.fixture
def noisy_prices(monkeypatch):
    market = np.random.default_rng(1).normal(0, 0.01, 4000)

    async def _fake(symbol: str, start: date):
        if symbol == "YOUNG":  # listed 40 days ago
            first = TODAY - timedelta(days=40)
            d, out, px = first, {}, 50.0
            while d <= TODAY:
                if d.weekday() < 5:
                    out[d] = px
                    px *= 1.001
                d += timedelta(days=1)
            return out
        if symbol not in PROFILE:
            raise ValueError("unknown")
        drift, vol, loading = PROFILE[symbol]
        noise = np.random.default_rng(zlib.crc32(symbol.encode())).normal(0, vol, 4000)
        d, i, px, out = start, 0, 100.0, {}
        while d <= TODAY:
            if d.weekday() < 5:
                out[d] = px
                px *= 1 + drift + loading * market[i] + noise[i]
                i += 1
            d += timedelta(days=1)
        return out

    monkeypatch.setattr(price_history_service, "_download_closes", _fake)
    monkeypatch.setattr(price_history_service, "RETRY_DELAYS_S", (0.0,))
    price_history_service._recent_failures.clear()


async def test_risk_report_for_a_portfolio(noisy_prices):
    async with _client() as client:
        headers = await _token(client, "risk1@example.com")
        pid = await _portfolio(client, headers, [(1, {"TWIN1": 10, "TWIN2": 10, "CALM": 30})])
        r = await client.get(f"/portfolio/{pid}/risk?lookback=1y", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    risk = body["risk"]
    assert body["warnings"] == []
    assert risk["observations"] > 200
    assert risk["stats"]["volatility"] > 0
    assert 0 < risk["stats"]["beta"] < 1.5
    betas = {h["ticker"]: h["beta"] for h in risk["holdings"]}
    assert betas["TWIN1"] > 3 * betas["CALM"]
    assert risk["stats"]["var_95"] > 0 and risk["stats"]["cvar_95"] >= risk["stats"]["var_95"]
    # The twins move together and dominate risk.
    assert set(risk["clusters"][0]["tickers"]) == {"TWIN1", "TWIN2"}
    shares = {h["ticker"]: h["risk_share"] for h in risk["holdings"]}
    weights = {h["ticker"]: h["weight"] for h in risk["holdings"]}
    # The volatile, correlated pair carries far more of the risk than of the value.
    assert shares["TWIN1"] + shares["TWIN2"] > 1.5 * (weights["TWIN1"] + weights["TWIN2"])
    assert sum(shares.values()) == pytest.approx(1.0, abs=1e-3)
    assert risk["monte_carlo"]["terminal"]["p5"] < risk["monte_carlo"]["terminal"]["p95"]

    stress = {s["id"]: s for s in body["stress"]}
    assert set(stress) == {"gfc", "covid", "rates_2022", "carry_2024", "tariffs_2025"}
    # Inside the 5-year store: replayed from stored prices; outside it: the index fallback.
    assert stress["tariffs_2025"]["market_source"] == "stored prices"
    assert stress["tariffs_2025"]["replayed_weight"] == pytest.approx(1.0)
    assert stress["gfc"]["market_source"] == "S&P 500 index levels"
    assert stress["gfc"]["market_return"] == pytest.approx(-0.5678)
    assert all(leg["method"] == "beta" for leg in stress["gfc"]["worst"])


async def test_young_and_unknown_holdings_are_reported(noisy_prices):
    async with _client() as client:
        headers = await _token(client, "risk2@example.com")
        pid = await _portfolio(client, headers, [(1, {"CALM": 10, "YOUNG": 5, "NOPE": 3})])
        body = (await client.get(f"/portfolio/{pid}/risk?lookback=6m", headers=headers)).json()
    w = " ".join(body["warnings"])
    assert "No price for NOPE" in w
    # YOUNG has ~28 trading days: enough to be included over 6m.
    assert {h["ticker"] for h in body["risk"]["holdings"]} == {"CALM", "YOUNG"}
    young_2022 = next(s for s in body["stress"] if s["id"] == "rates_2022")
    methods = {leg["ticker"]: leg["method"] for leg in young_2022["worst"]}
    assert methods["YOUNG"] in ("beta", "market")  # did not trade in 2022
    assert methods["CALM"] == "actual"


async def test_risk_empty_validation_and_ownership(noisy_prices):
    async with _client() as client, _client() as other:
        headers = await _token(client, "risk3@example.com")
        other_headers = await _token(other, "risk4@example.com")
        pid = (await client.post("/portfolio", json={"name": "E"}, headers=headers)).json()["id"]
        empty = (await client.get(f"/portfolio/{pid}/risk", headers=headers)).json()
        assert empty["risk"] is None and empty["message"]
        assert (await client.get(f"/portfolio/{pid}/risk?lookback=10y", headers=headers)).status_code == 422
        assert (await client.get(f"/portfolio/{pid}/risk?benchmark=a%20b", headers=headers)).status_code == 422
        assert (await other.get(f"/portfolio/{pid}/risk", headers=other_headers)).status_code == 404
