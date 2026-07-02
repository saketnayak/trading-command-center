import pandas as pd
import pytest

from app.services import yfinance_service

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def clear_history_cache():
    yfinance_service._history_cache.clear()
    yield
    yfinance_service._history_cache.clear()


def make_history_frame(first_close: float = 100.0) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Open": [first_close - 1.0, first_close],
            "High": [first_close + 1.0, first_close + 2.0],
            "Low": [first_close - 2.0, first_close - 1.0],
            "Close": [first_close, first_close + 1.0],
            "Volume": [1000, 1200],
        },
        index=pd.date_range("2024-01-01", periods=2, freq="D"),
    )


@pytest.mark.asyncio
async def test_fetch_history_reuses_cached_download(monkeypatch):
    calls = []

    def fake_download(symbol: str, **kwargs):
        calls.append((symbol, kwargs))
        return make_history_frame()

    monkeypatch.setattr(yfinance_service, "_download_history_sync", fake_download)

    first = await yfinance_service.fetch_history("aapl", start="2024-01-01", interval="1d", auto_adjust=False)
    first.loc[first.index[0], "Close"] = 999.0
    second = await yfinance_service.fetch_history("AAPL", start="2024-01-01", interval="1d", auto_adjust=False)

    assert len(calls) == 1
    assert calls[0] == (
        "AAPL",
        {"start": "2024-01-01", "end": None, "interval": "1d", "auto_adjust": False},
    )
    assert second.loc[second.index[0], "Close"] == pytest.approx(100.0)


@pytest.mark.asyncio
async def test_fetch_history_keeps_auto_adjust_entries_separate(monkeypatch):
    calls = []

    def fake_download(symbol: str, **kwargs):
        calls.append((symbol, kwargs))
        close = 200.0 if kwargs["auto_adjust"] else 100.0
        return make_history_frame(close)

    monkeypatch.setattr(yfinance_service, "_download_history_sync", fake_download)

    unadjusted = await yfinance_service.fetch_history("MSFT", start="2024-01-01", auto_adjust=False)
    adjusted = await yfinance_service.fetch_history("MSFT", start="2024-01-01", auto_adjust=True)

    assert len(calls) == 2
    assert unadjusted.loc[unadjusted.index[0], "Close"] == pytest.approx(100.0)
    assert adjusted.loc[adjusted.index[0], "Close"] == pytest.approx(200.0)


@pytest.mark.asyncio
async def test_fetch_history_period_uses_period_cache_key(monkeypatch):
    calls = []

    def fake_download(symbol: str, **kwargs):
        calls.append((symbol, kwargs))
        return make_history_frame()

    monkeypatch.setattr(yfinance_service, "_download_history_sync", fake_download)

    await yfinance_service.fetch_history_period("SPY", period="2y", interval="1d")
    await yfinance_service.fetch_history_period("SPY", period="2y", interval="1d")

    assert len(calls) == 1
    assert calls[0] == (
        "SPY",
        {"period": "2y", "interval": "1d", "auto_adjust": True},
    )


@pytest.mark.asyncio
async def test_fetch_historical_close_uses_latest_close_in_window(monkeypatch):
    calls = []

    async def fake_fetch_history(symbol: str, **kwargs):
        calls.append((symbol, kwargs))
        return make_history_frame(150.0)

    monkeypatch.setattr(yfinance_service, "fetch_history", fake_fetch_history)

    close = await yfinance_service.fetch_historical_close(
        "aapl",
        pd.Timestamp("2024-01-10").date(),
    )

    assert close == pytest.approx(151.0)
    assert calls == [
        (
            "aapl",
            {"start": "2024-01-03", "end": "2024-01-11", "interval": "1d"},
        )
    ]


def test_prepare_ohlcv_frame_selects_required_columns():
    frame = pd.DataFrame(
        {
            "Open": [100.0, 101.0],
            "High": [102.0, 103.0],
            "Low": [99.0, 100.0],
            "Close": [101.0, 102.0],
            "Adj Close": [101.0, 102.0],
            "Volume": [1000, 1100],
        },
        index=pd.date_range("2024-01-01", periods=2, freq="D"),
    )

    prepared = yfinance_service.prepare_ohlcv_frame(frame, "AAPL")

    assert list(prepared.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert len(prepared) == 2


@pytest.mark.asyncio
async def test_fetch_company_profile_returns_mapped_fields(monkeypatch):
    class FakeInfo(dict):
        pass

    def fake_ticker(_symbol: str):
        class FakeTicker:
            info = FakeInfo(
                {
                    "longName": "Apple Inc.",
                    "shortName": "Apple",
                    "sector": "Technology",
                    "industry": "Consumer Electronics",
                    "website": "https://www.apple.com",
                    "exchange": "NMS",
                    "country": "United States",
                    "currency": "USD",
                    "marketCap": 3_000_000_000_000,
                }
            )

        return FakeTicker()

    monkeypatch.setattr(yfinance_service.yf, "Ticker", fake_ticker)

    profile = await yfinance_service.fetch_company_profile("AAPL")
    assert profile is not None
    assert profile["longName"] == "Apple Inc."
    assert profile["marketCap"] == 3_000_000_000_000
