# S&P 500 approximate sector weights (updated Q1 2026).
# Source: SPDR sector ETF market caps. Update quarterly.
SP500_SECTOR_WEIGHTS: dict[str, float] = {
    "Technology": 0.293,
    "Financials": 0.131,
    "Healthcare": 0.126,
    "Consumer Discretionary": 0.105,
    "Communication Services": 0.089,
    "Industrials": 0.086,
    "Consumer Staples": 0.058,
    "Energy": 0.038,
    "Real Estate": 0.023,
    "Materials": 0.021,
    "Utilities": 0.021,
}

# Representative sector leaders used when a sector is underweight.
# Tickers are ordered by market cap descending within each sector.
SECTOR_LEADERS: dict[str, list[str]] = {
    "Healthcare": ["UNH", "LLY", "JNJ", "ABBV", "MRK"],
    "Financials": ["JPM", "BAC", "WFC", "GS", "MS"],
    "Energy": ["XOM", "CVX", "COP", "SLB", "EOG"],
    "Utilities": ["NEE", "SO", "DUK", "AEP", "SRE"],
    "Materials": ["LIN", "APD", "SHW", "ECL", "NEM"],
    "Real Estate": ["AMT", "PLD", "EQIX", "CCI", "SPG"],
    "Consumer Staples": ["PG", "KO", "PEP", "WMT", "COST"],
    "Industrials": ["UPS", "HON", "GE", "CAT", "RTX"],
    "Communication Services": ["META", "GOOGL", "NFLX", "DIS", "T"],
    "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "NKE"],
    "Technology": ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL"],
}
