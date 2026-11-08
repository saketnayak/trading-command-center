"""Unit test: live FX quotes are read from one Yahoo download of `<CCY>=X` pairs."""
from datetime import datetime, timezone

import pandas as pd
import pytest

from app.services import yfinance_service

pytestmark = pytest.mark.unit


async def test_fetch_fx_quotes_takes_the_last_close_and_its_time(monkeypatch):
    idx = pd.DatetimeIndex(["2026-01-02 14:55", "2026-01-02 15:00"], tz="UTC")
    cols = pd.MultiIndex.from_product([["Close", "Open"], ["AUD=X", "EUR=X", "JPY=X"]], names=["Price", "Ticker"])
    frame = pd.DataFrame([[1.51, 0.92, 150.0, 1, 1, 1], [1.52, float("nan"), 151.0, 1, 1, 1]], index=idx, columns=cols)
    seen = {}

    def fake_download(tickers, **kwargs):
        seen["tickers"] = tickers
        return frame

    monkeypatch.setattr(yfinance_service.yf, "download", fake_download)
    quotes = await yfinance_service.fetch_fx_quotes(["AUD", "EUR", "JPY", "NZD"])

    assert seen["tickers"] == ["AUD=X", "EUR=X", "JPY=X", "NZD=X"]
    assert quotes["AUD"] == (1.52, datetime(2026, 1, 2, 15, 0, tzinfo=timezone.utc))
    assert quotes["EUR"] == (0.92, datetime(2026, 1, 2, 14, 55, tzinfo=timezone.utc))  # last non-NaN bar
    assert "NZD" not in quotes


async def test_fetch_fx_quotes_returns_nothing_for_an_empty_download(monkeypatch):
    monkeypatch.setattr(yfinance_service.yf, "download", lambda tickers, **kw: pd.DataFrame())
    assert await yfinance_service.fetch_fx_quotes(["AUD"]) == {}
