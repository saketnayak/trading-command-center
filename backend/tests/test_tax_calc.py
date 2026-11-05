"""Unit tests: wash sales, the tax-year report, harvest candidates and replacement ideas."""
import math
from datetime import date, timedelta

import pytest

from app.services.ledger_calc import Lot, Tx, replay
from app.services.tax_calc import BuyRef, harvest_candidates, replacement_ideas, tax_year_report, wash_sales

pytestmark = pytest.mark.unit
D0 = date(2025, 1, 2)


def _tx(seq, days, type_, sym, qty, price, account="Main"):
    return Tx(seq=seq, date=D0 + timedelta(days=days), type=type_, symbol=sym, quantity=qty, price=price,
              account=account, id=f"t{seq}")


def _buys(txs, portfolio="P"):
    return [BuyRef(t.id, t.date, t.symbol, t.quantity, t.account, portfolio) for t in txs if t.type == "BUY"]


def test_partial_wash_sale_from_a_buy_after_the_loss():
    txs = [_tx(1, 0, "BUY", "AAA", 10, 100), _tx(2, 400, "SELL", "AAA", 10, 80), _tx(3, 410, "BUY", "AAA", 4, 82)]
    st = replay(txs)
    wash = wash_sales(st.realised, _buys(txs))
    assert wash[0]["disallowed"] == pytest.approx(80.0)  # 4 of 10 loss shares replaced: 40% of $200
    assert wash[0]["replacements"] == [{"date": "2026-02-16", "account": "Main", "portfolio": "P", "quantity": 4}]
    rep = tax_year_report(st.realised, wash, 2026)
    row = rep["rows"][0]
    assert row["code"] == "W" and row["term"] == "long" and row["gain"] == -200 and row["adjusted_gain"] == -120
    assert rep["totals"][0]["long"]["adjustment"] == 80 and rep["totals"][0]["net"] == -120


def test_shares_sold_in_the_same_sale_are_not_their_own_replacement():
    # Two buys 10 days apart, both sold together at a loss: no wash sale.
    txs = [_tx(1, 0, "BUY", "AAA", 5, 100), _tx(2, 10, "BUY", "AAA", 5, 100), _tx(3, 20, "SELL", "AAA", 10, 90)]
    st = replay(txs)
    assert wash_sales(st.realised, _buys(txs)) == {}
    # But a buy 10 days before a sale that only takes the older lot does wash it (FIFO).
    txs = [_tx(1, 0, "BUY", "AAA", 5, 100), _tx(2, 10, "BUY", "AAA", 5, 100), _tx(3, 20, "SELL", "AAA", 5, 90)]
    st = replay(txs)
    assert wash_sales(st.realised, _buys(txs))[0]["disallowed"] == pytest.approx(50.0)


def test_gains_and_far_buys_are_never_washed_and_each_replacement_share_counts_once():
    txs = [_tx(1, 0, "BUY", "AAA", 10, 100), _tx(2, 100, "SELL", "AAA", 5, 120), _tx(3, 200, "SELL", "AAA", 5, 90),
           _tx(4, 240, "BUY", "AAA", 5, 90)]
    st = replay(txs)
    assert wash_sales(st.realised, _buys(txs)) == {}  # gain sale; the loss's rebuy is 40 days later
    # Two loss sales share one 3-share replacement buy: the first sale takes it all.
    txs = [_tx(1, 0, "BUY", "AAA", 10, 100), _tx(2, 100, "SELL", "AAA", 3, 90), _tx(3, 105, "SELL", "AAA", 3, 90),
           _tx(4, 110, "BUY", "AAA", 3, 91)]
    st = replay(txs)
    wash = wash_sales(st.realised, _buys(txs))
    assert set(wash) == {0} and wash[0]["matched_quantity"] == 3


def test_buys_in_other_portfolios_count():
    txs = [_tx(1, 0, "BUY", "AAA", 10, 100), _tx(2, 50, "SELL", "AAA", 10, 90)]
    other = [BuyRef("x1", D0 + timedelta(days=45), "AAA", 20, "IRA", "Other")]
    wash = wash_sales(replay(txs).realised, _buys(txs) + other)
    assert wash[0]["disallowed"] == pytest.approx(100.0) and wash[0]["replacements"][0]["portfolio"] == "Other"


def test_harvest_candidates_rank_losses_and_flag_recent_buys():
    today = date(2026, 11, 5)
    lots = {
        ("Main", "AAA"): [Lot(date(2025, 1, 2), 10, 100.0, "a1"), Lot(date(2026, 10, 20), 2, 60.0, "a2")],
        ("Main", "BBB"): [Lot(date(2026, 6, 1), 10, 50.0, "b1")],
        ("Main", "CCC"): [Lot(date(2026, 1, 1), 1, 10.0, "c1")],  # no price
    }
    buys = [BuyRef("a2", date(2026, 10, 20), "AAA", 2, "Main", "P"), BuyRef("b1", date(2026, 6, 1), "BBB", 10, "Main", "P")]
    out = harvest_candidates(lots, {"AAA": 70.0, "BBB": 45.0}, {"AAA": 1.0, "BBB": 2.0}, buys, today, min_loss=100)
    assert [(c["symbol"], c["open_date"], c["loss"]) for c in out] == [("AAA", "2025-01-02", -300.0), ("BBB", "2026-06-01", -100.0)]
    aaa, bbb = out
    assert aaa["term"] == "long" and aaa["recent_buys"][0]["date"] == "2026-10-20"  # the newer lot washes a sale now
    assert bbb["loss_local"] == -50.0 and bbb["term"] == "short" and bbb["days_to_long_term"] == 366 - 157
    assert bbb["recent_buys"] == [] and aaa["avoid_buying_until"] == "2026-12-06"


def test_replacement_ideas_rank_by_correlation_and_skip_same_index_funds():
    days = [D0 + timedelta(days=i) for i in range(250)]
    base = [math.sin(i * 0.7) * 0.01 + math.cos(i * 1.3) * 0.006 for i in range(250)]
    noise = [math.sin(i * 2.9) * 0.01 for i in range(250)]

    def series(mix):
        px, out = 100.0, {}
        for d, b, n in zip(days, base, noise):
            px *= 1 + b + mix * n
            out[d] = px
        return out

    closes = {"VOO": series(0.0), "SPY": series(0.0), "XLK": series(0.3), "XLU": series(5.0), "QQQ": series(0.1)}
    ideas = replacement_ideas("voo", closes)
    assert [i["symbol"] for i in ideas] == ["QQQ", "XLK"]  # SPY tracks the same index; XLU barely correlates
    assert ideas[0]["correlation"] > ideas[1]["correlation"] >= 0.3
    assert {i["strength"] for i in ideas} <= {"close", "moderate", "loose"}
    assert replacement_ideas("NEW", {"NEW": series(0.0)}) == []  # nothing in the pool has prices
