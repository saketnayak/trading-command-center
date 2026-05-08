_QUOTE_CURRENCIES = frozenset({"USD", "USDT", "USDC", "BTC", "ETH", "EUR"})


def is_crypto(ticker: str) -> bool:
    """Return True for crypto tickers (format: BTC-USD, ETH-USDC, SOL-USDT, etc.).

    Requires a recognised quote currency suffix to avoid misclassifying
    hyphenated equities such as BRK-B or BF-B.
    """
    parts = ticker.split("-")
    return len(parts) >= 2 and parts[-1].upper() in _QUOTE_CURRENCIES
