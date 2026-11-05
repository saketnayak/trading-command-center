"""Unit tests: net-worth series, breakdown, sampling and wallet address checks."""
from datetime import date, timedelta

import pytest

from app.services.net_worth_calc import ItemInput, Steps, breakdown, net_worth_series, sample_dates
from app.services.wallet_service import valid_address

pytestmark = pytest.mark.unit
D = date(2026, 1, 5)  # a Monday


def test_steps_hold_the_latest_value_and_respect_the_gap():
    s = Steps({D: 1.0, D + timedelta(days=10): 2.0}, max_gap_days=7)
    assert s.at(D - timedelta(days=1)) is None
    assert s.at(D + timedelta(days=5)) == 1.0
    assert s.at(D + timedelta(days=8)) is None  # stale beyond 7 days
    assert s.at(D + timedelta(days=12)) == 2.0


def test_series_combines_portfolios_items_wallets_and_liabilities():
    days = [D, D + timedelta(days=7), D + timedelta(days=14)]
    portfolios = {"p1": {D: 1000.0, D + timedelta(days=14): 1100.0}, "p2": {D + timedelta(days=7): 500.0}}
    items = [
        ItemInput("h", "asset", "real_estate", "House", [(D + timedelta(days=7), 300_000.0)], factor=1.0),
        ItemInput("m", "liability", "mortgage", "Mortgage", [(D, 200_000.0), (D + timedelta(days=14), 199_000.0)], factor=1.0),
        ItemInput("e", "asset", "cash", "Euro savings", [(D, 1000.0)], factor=1.1),
        ItemInput("w", "asset", "crypto_wallet", "Cold wallet", [(D, 0.5)], factor=2.0,
                  coin_closes={D: 40_000.0, D + timedelta(days=7): 50_000.0}),
    ]
    s = net_worth_series(days, portfolios, items)
    assert s[0] == {"date": "2026-01-05", "investments": 1000.0, "other_assets": 1100.0 + 40_000.0,
                    "liabilities": 200_000.0, "net_worth": 1000.0 + 41_100.0 - 200_000.0}
    # Week 2: p2 starts, the house appears, the wallet reprices.
    assert s[1]["investments"] == 1500.0 and s[1]["other_assets"] == 300_000 + 1100 + 50_000
    # Week 3: p1 updates, the mortgage drops, the wallet's last price is 7 days old (still used).
    assert s[2]["investments"] == 1600.0 and s[2]["liabilities"] == 199_000.0
    assert s[2]["other_assets"] == 300_000 + 1100 + 50_000


def test_breakdown_groups_by_category():
    items = [
        (ItemInput("h", "asset", "real_estate", "House", [], 1.0), 300_000.0),
        (ItemInput("c", "asset", "cash", "Cash", [], 1.0), 20_000.0),
        (ItemInput("m", "liability", "mortgage", "Mortgage", [], 1.0), 160_000.0),
        (ItemInput("x", "asset", "cash", "No value yet", [], 1.0), None),
    ]
    b = breakdown({"p1": 80_000.0}, items)
    assert b["assets"] == 400_000 and b["liabilities"] == 160_000 and b["net_worth"] == 240_000
    assert b["investments"] == 80_000 and b["debt_ratio"] == pytest.approx(0.4)
    assert [r["category"] for r in b["assets_by_category"]] == ["real_estate", "investments", "cash"]
    assert b["assets_by_category"][1]["label"] == "Portfolios" and b["assets_by_category"][0]["share"] == 0.75


def test_sample_dates_weekly_and_fallback():
    trading = [D + timedelta(days=i) for i in range(30) if (D + timedelta(days=i)).weekday() < 5]
    end = D + timedelta(days=29)
    weekly = sample_dates(D, end, trading, weekly=True)
    assert len(weekly) == 5 and weekly[-1] == end  # one per ISO week, plus the end day
    daily = sample_dates(D, end, trading, weekly=False)
    assert daily[:2] == [D, D + timedelta(days=1)] and daily[-1] == end
    fridays = sample_dates(D, end, [], weekly=False)
    assert fridays[0] == date(2026, 1, 9) and all(d.weekday() == 4 for d in fridays[:-1]) and fridays[-1] == end


def test_wallet_addresses():
    assert valid_address("btc", "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh")
    assert valid_address("btc", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")
    assert not valid_address("btc", "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe")
    assert valid_address("eth", "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe")
    assert not valid_address("eth", "0x123") and not valid_address("doge", "D123")
