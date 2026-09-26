import pytest

from jev_loop.assets import UnknownSymbolError, resolve_symbol, size_order

pytestmark = pytest.mark.unit


def test_resolves_crypto_pairs():
    for sym in ("BTC/USD", "ETH/USD", "SOL/USD"):
        spec = resolve_symbol(sym)
        assert spec.asset_class == "crypto"
        assert spec.is_24_7 is True
        assert spec.has_depth is True
        assert spec.min_notional_usd == 10.0


def test_resolves_equity_tickers():
    for sym in ("AAPL", "SPY", "TSLA", "NVDA"):
        spec = resolve_symbol(sym)
        assert spec.asset_class == "us_equity"
        assert spec.is_24_7 is False
        assert spec.has_depth is False
        assert spec.orderbook_url is None


def test_resolution_is_case_insensitive():
    assert resolve_symbol("btc/usd").symbol == "BTC/USD"
    assert resolve_symbol(" aapl ").symbol == "AAPL"


def test_app_style_crypto_ticker_is_normalised_to_alpaca_form():
    # AgentFloor (yfinance) spells crypto as BTC-USD; Alpaca wants BTC/USD.
    assert resolve_symbol("BTC-USD").symbol == "BTC/USD"


def test_unknown_symbol_raises_with_a_helpful_message():
    with pytest.raises(UnknownSymbolError) as exc_info:
        resolve_symbol("not a real symbol!!")
    assert "BTC/USD" in str(exc_info.value)
    assert "AAPL" in str(exc_info.value)


def test_size_order_meets_crypto_minimum_at_low_target():
    spec = resolve_symbol("BTC/USD")
    qty = size_order(notional_usd=0.01, price=85_000.0, spec=spec)
    assert qty * 85_000.0 >= spec.min_notional_usd


def test_size_order_meets_equity_minimum():
    spec = resolve_symbol("AAPL")
    qty = size_order(notional_usd=0.10, price=337.0, spec=spec)
    assert qty * 337.0 >= spec.min_notional_usd


def test_size_order_respects_precision():
    spec = resolve_symbol("AAPL")
    qty = size_order(notional_usd=50.0, price=337.03, spec=spec)
    assert round(qty, spec.qty_precision) == qty


def test_size_order_rejects_non_positive_price():
    with pytest.raises(ValueError):
        size_order(notional_usd=20.0, price=0.0, spec=resolve_symbol("BTC/USD"))
