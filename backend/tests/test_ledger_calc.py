"""Unit tests for the transaction ledger maths and XIRR (pure; no DB)."""
from datetime import date

import pytest

from app.services.ledger_calc import Tx, TxError, holdings_timeline, positions, replay, summary, validate
from app.services.performance_calc import xirr

pytestmark = pytest.mark.unit

_seq = iter(range(10_000))


def T(d, type_, symbol=None, quantity=0.0, price=0.0, amount=0.0, fees=0.0, account="Main", currency="USD"):
    return Tx(next(_seq), date.fromisoformat(d), type_, symbol, quantity, price, amount, fees, account, currency)


BUYS = [
    T("2024-01-10", "BUY", "AAA", 10, 100, fees=10),  # cost/share 101
    T("2024-06-10", "BUY", "AAA", 10, 150),  # 150
    T("2025-03-01", "BUY", "AAA", 10, 120),  # 120
]


def test_validation_by_type():
    validate(T("2025-01-01", "BUY", "AAA", 1, 10))
    for bad in (T("2025-01-01", "BUY", None, 1, 10), T("2025-01-01", "BUY", "AAA", 0, 10),
                T("2025-01-01", "SELL", "AAA", 1, -1), T("2025-01-01", "DIVIDEND", "AAA", amount=0),
                T("2025-01-01", "SPLIT", "AAA", 0), T("2025-01-01", "MOON", "AAA", 1, 1)):
        with pytest.raises(TxError):
            validate(bad)


def test_fifo_realises_oldest_lots_with_terms():
    st = replay(BUYS + [T("2025-04-01", "SELL", "AAA", 15, 200, fees=15)], "fifo")
    lots = sorted(st.realised, key=lambda r: r.open_date)
    assert [round(r.quantity, 6) for r in lots] == [10, 5]
    # proceeds 15×200 − 15 fees = 2,985, split by quantity
    assert lots[0].proceeds == pytest.approx(1990.0) and lots[0].cost == pytest.approx(1010.0)
    assert lots[0].term == "long"  # held 2024-01-10 → 2025-04-01
    assert lots[1].proceeds == pytest.approx(995.0) and lots[1].cost == pytest.approx(750.0)
    assert lots[1].term == "short"  # 2024-06-10 → 2025-04-01 is < 366 days
    pos = positions(st)[0]
    assert pos["quantity"] == pytest.approx(15) and pos["cost"] == pytest.approx(5 * 150 + 10 * 120)


def test_hifo_takes_the_most_expensive_lots_first():
    st = replay(BUYS + [T("2025-04-01", "SELL", "AAA", 10, 200)], "hifo")
    assert [r.cost / r.quantity for r in st.realised] == [pytest.approx(150.0)]


def test_average_cost_pools_basis_but_keeps_fifo_dates():
    st = replay(BUYS + [T("2025-04-01", "SELL", "AAA", 15, 200)], "average")
    avg = (1010 + 1500 + 1200) / 30
    assert sum(r.cost for r in st.realised) == pytest.approx(15 * avg)
    assert {r.term for r in st.realised} == {"long", "short"}
    assert positions(st)[0]["avg_cost"] == pytest.approx(avg)


def test_split_scales_lots_and_selling_more_than_held_never_shorts():
    st = replay([T("2024-01-02", "BUY", "XYZ", 10, 100), T("2024-06-01", "SPLIT", "XYZ", 2),
                 T("2024-07-01", "SELL", "XYZ", 25, 60)])
    assert sum(r.quantity for r in st.realised) == pytest.approx(20)
    assert sum(r.cost for r in st.realised) == pytest.approx(1000.0)  # split keeps total basis
    assert positions(st) == []
    assert st.warnings and "only 20 were held" in st.warnings[0]


def test_selling_with_nothing_held_says_the_buy_is_missing():
    st = replay([T("2024-07-01", "SELL", "XYZ", 25, 60)])
    assert st.realised == []
    assert "no XYZ" in st.warnings[0] and "buy" in st.warnings[0] and "were held" not in st.warnings[0]


def test_accounts_are_kept_apart():
    st = replay([T("2024-01-02", "BUY", "AAA", 5, 10, account="IRA"), T("2024-01-03", "BUY", "AAA", 5, 20, account="Taxable"),
                 T("2024-02-01", "SELL", "AAA", 5, 30, account="Taxable")])
    assert st.realised[0].cost == pytest.approx(100.0) and st.realised[0].account == "Taxable"
    lots = positions(st)[0]["lots"]
    assert [(lot["account"], lot["quantity"]) for lot in lots] == [("IRA", 5)]


def test_cash_income_fees_and_contributions():
    st = replay([
        T("2024-01-01", "DEPOSIT", amount=5000), T("2024-01-02", "BUY", "AAA", 10, 100, fees=5),
        T("2024-03-01", "DIVIDEND", "AAA", amount=12.5), T("2024-04-01", "INTEREST", amount=3),
        T("2024-05-01", "FEE", amount=2), T("2024-06-01", "SELL", "AAA", 5, 110, fees=5),
        T("2024-07-01", "WITHDRAWAL", amount=1000),
    ])
    s = summary(st)
    assert s["cash"] == [{"account": "Main", "currency": "USD",
                          "balance": round(5000 - 1005 + 12.5 + 3 - 2 + 545 - 1000, 2)}]
    assert s["contributions"] == [{"account": "Main", "currency": "USD", "net": 4000.0}]
    assert s["fees"] == {"USD": 12.0} and s["cash_tracked"] is True
    assert {(i["type"], i["amount"]) for i in s["income"]} == {("DIVIDEND", 12.5), ("INTEREST", 3.0)}
    assert s["realised"][0]["gain"] == pytest.approx(545 - 502.5)


def test_holdings_timeline_collapses_same_day_trades():
    tl = holdings_timeline([T("2024-01-02", "BUY", "A", 10, 1), T("2024-01-02", "BUY", "B", 5, 1),
                            T("2024-02-01", "SELL", "A", 10, 1), T("2024-03-01", "DIVIDEND", "B", amount=1)])
    assert tl == [(date(2024, 1, 2), {"A": 10, "B": 5}), (date(2024, 2, 1), {"B": 5})]


def test_xirr_matches_simple_cases():
    assert xirr([(date(2024, 1, 1), -1000), (date(2025, 1, 1), 1100)]) == pytest.approx(0.0997, abs=1e-3)
    # Two equal deposits, flat value: 0%.
    assert xirr([(date(2024, 1, 1), -100), (date(2024, 7, 1), -100), (date(2025, 1, 1), 200)]) == pytest.approx(0, abs=1e-6)
    assert xirr([(date(2024, 1, 1), -100)]) is None
    assert xirr([(date(2024, 1, 1), 100), (date(2025, 1, 1), 50)]) is None  # no sign change
