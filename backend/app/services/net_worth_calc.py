"""Net-worth maths: portfolios plus manual assets, liabilities and crypto
wallets, today and over time. Pure, no I/O.

- A manual item's value on a day is its latest valuation on or before that
  day, converted at today's FX rate (like the rest of the app). Before its
  first valuation the item does not count.
- A wallet's valuations are coin balances; its value is balance × that day's
  close (USD, forward-filled at most 7 days) × the USD → display rate.
- A portfolio's value comes from its Performance series and is forward-filled
  between trading days. Before the series starts it counts as 0.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass, field
from datetime import date, timedelta

ASSET_CATEGORIES = ("cash", "real_estate", "vehicle", "private_investment", "retirement", "crypto_wallet", "other_asset")
LIABILITY_CATEGORIES = ("mortgage", "loan", "credit_card", "other_liability")
CATEGORY_LABELS = {
    "cash": "Cash", "real_estate": "Real estate", "vehicle": "Vehicles", "private_investment": "Private investments",
    "retirement": "Retirement accounts", "crypto_wallet": "Crypto wallets", "other_asset": "Other assets",
    "mortgage": "Mortgages", "loan": "Loans", "credit_card": "Credit cards", "other_liability": "Other liabilities",
    "investments": "Portfolios",
}
MAX_PRICE_GAP_DAYS = 7


class Steps:
    """A step function over dates: the latest value on or before a day."""

    def __init__(self, points: dict[date, float] | list[tuple[date, float]], max_gap_days: int | None = None):
        items = sorted(points.items() if isinstance(points, dict) else points)
        self.dates = [d for d, _ in items]
        self.values = [v for _, v in items]
        self.max_gap = max_gap_days

    def at(self, d: date) -> float | None:
        i = bisect.bisect_right(self.dates, d) - 1
        if i < 0:
            return None
        if self.max_gap is not None and (d - self.dates[i]).days > self.max_gap:
            return None
        return self.values[i]


@dataclass
class ItemInput:
    id: str
    kind: str  # asset | liability
    category: str
    name: str
    valuations: list[tuple[date, float]]
    factor: float  # item currency (USD for a wallet) → display currency
    coin_closes: dict[date, float] | None = None  # set for a wallet
    _steps: Steps = field(init=False, repr=False)
    _prices: Steps | None = field(init=False, repr=False)

    def __post_init__(self):
        self._steps = Steps(self.valuations)
        self._prices = Steps(self.coin_closes, MAX_PRICE_GAP_DAYS) if self.coin_closes is not None else None

    def value_on(self, d: date) -> float | None:
        v = self._steps.at(d)
        if v is None:
            return None
        if self._prices is not None:
            px = self._prices.at(d)
            return None if px is None else v * px * self.factor
        return v * self.factor


def sample_dates(start: date, end: date, observed: list[date], weekly: bool) -> list[date]:
    """The chart's dates: the portfolios' trading days (or every Friday when there are none),
    thinned to one per week for long ranges, always ending on `end`."""
    days = sorted({d for d in observed if start <= d <= end})
    if not days:
        d = start + timedelta(days=(4 - start.weekday()) % 7)
        while d <= end:
            days.append(d)
            d += timedelta(days=7)
    if weekly:
        by_week: dict[tuple[int, int], date] = {}
        for d in days:
            by_week[d.isocalendar()[:2]] = d  # last day seen in each ISO week
        days = sorted(by_week.values())
    if not days or days[-1] != end:
        days.append(end)
    return days


def net_worth_series(dates: list[date], portfolios: dict[str, dict[date, float]], items: list[ItemInput]) -> list[dict]:
    steps = {name: Steps(series) for name, series in portfolios.items()}
    out = []
    for d in dates:
        investments = sum(v for s in steps.values() if (v := s.at(d)) is not None)
        assets = liabilities = 0.0
        for it in items:
            v = it.value_on(d)
            if v is None:
                continue
            if it.kind == "liability":
                liabilities += v
            else:
                assets += v
        out.append({
            "date": d.isoformat(),
            "investments": round(investments, 2),
            "other_assets": round(assets, 2),
            "liabilities": round(liabilities, 2),
            "net_worth": round(investments + assets - liabilities, 2),
        })
    return out


def breakdown(portfolio_values: dict[str, float], items: list[tuple[ItemInput, float | None]]) -> dict:
    """Today's totals and the split by category (portfolios grouped as "investments")."""
    assets_by: dict[str, float] = {}
    liabilities_by: dict[str, float] = {}
    investments = sum(portfolio_values.values())
    if investments:
        assets_by["investments"] = investments
    for it, value in items:
        if value is None:
            continue
        bucket = liabilities_by if it.kind == "liability" else assets_by
        bucket[it.category] = bucket.get(it.category, 0.0) + value
    assets = sum(assets_by.values())
    liabilities = sum(liabilities_by.values())

    def rows(d: dict[str, float], total: float) -> list[dict]:
        return [{"category": k, "label": CATEGORY_LABELS.get(k, k), "value": round(v, 2),
                 "share": round(v / total, 6) if total else None}
                for k, v in sorted(d.items(), key=lambda kv: -kv[1])]

    return {
        "assets": round(assets, 2),
        "liabilities": round(liabilities, 2),
        "net_worth": round(assets - liabilities, 2),
        "investments": round(investments, 2),
        "debt_ratio": round(liabilities / assets, 6) if assets else None,
        "assets_by_category": rows(assets_by, assets),
        "liabilities_by_category": rows(liabilities_by, liabilities),
    }
