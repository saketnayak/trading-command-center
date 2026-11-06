"""Choosing which lots a sale closes (specific identification), as brokers such as UBS let you do.

Pure replay tests are marked unit; the API tests use the shared test client. Tickers LOTA–LOTD are unique
to this file."""
from datetime import date, timedelta

import pytest

from app.services.ledger_calc import Tx, TxError, replay, validate
from tests.test_portfolio_performance import _client, _portfolio, _token, fake_prices  # noqa: F401


def _buy(seq, d, qty, price, tx_id):
    return Tx(seq, d, "BUY", "LOTA", qty, price, id=tx_id)


BUYS = [_buy(1, date(2020, 1, 2), 10, 100.0, "a"), _buy(2, date(2021, 1, 4), 10, 200.0, "b"),
        _buy(3, date(2022, 1, 3), 10, 300.0, "c")]


def _sell(qty, picks=(), d=date(2023, 1, 3)):
    return Tx(9, d, "SELL", "LOTA", qty, 250.0, id="s", picks=picks)


def _closed(st):
    return [(r.open_tx_id, r.quantity, round(r.cost, 2)) for r in st.realised]


def _open(st):
    return [(lot.tx_id, lot.quantity) for lot in st.lots[("Main", "LOTA")]]


@pytest.mark.unit
def test_a_sale_closes_the_lots_it_names_instead_of_the_oldest():
    st = replay(BUYS + [_sell(10, (("b", 10),))])
    assert _closed(st) == [("b", 10, 2000.0)]
    assert _open(st) == [("a", 10), ("c", 10)]
    assert st.warnings == []


@pytest.mark.unit
def test_shares_not_named_follow_the_portfolio_method():
    st = replay(BUYS + [_sell(15, (("c", 5),))], "fifo")
    assert _closed(st) == [("c", 5, 1500.0), ("a", 10, 1000.0)]
    st = replay(BUYS + [_sell(15, (("a", 5),))], "hifo")
    assert _closed(st) == [("a", 5, 500.0), ("c", 10, 3000.0)]


@pytest.mark.unit
def test_a_lot_that_is_not_open_falls_back_with_a_warning():
    st = replay(BUYS + [_sell(10, (("gone", 10),))])
    assert _closed(st) == [("a", 10, 1000.0)]
    assert len(st.warnings) == 1 and "isn't open" in st.warnings[0]


@pytest.mark.unit
def test_naming_more_than_a_lot_holds_takes_what_is_left_and_warns():
    st = replay(BUYS + [_sell(4, (("a", 4),)), Tx(10, date(2023, 2, 1), "SELL", "LOTA", 10, 250.0, id="s2", picks=(("a", 10),))])
    assert _closed(st)[1:] == [("a", 6, 600.0), ("b", 4, 800.0)]
    assert any("only 6" in w for w in st.warnings)


@pytest.mark.unit
def test_validation():
    with pytest.raises(TxError, match="Only a sale"):
        validate(Tx(1, date(2023, 1, 1), "BUY", "LOTA", 1, 1.0, picks=(("a", 1),)))
    with pytest.raises(TxError, match="more than the sale"):
        validate(_sell(5, (("a", 3), ("b", 3))))
    with pytest.raises(TxError, match="above 0"):
        validate(_sell(5, (("a", 0),)))


def _d(days_ago: int) -> str:
    return (date.today() - timedelta(days=days_ago)).isoformat()


async def _add(c, h, pid, **tx):
    r = await c.post(f"/portfolio/{pid}/transactions", headers=h, json=tx)
    assert r.status_code == 201, r.text
    return r.json()


async def test_api_records_chosen_lots_lists_open_lots_and_reverts(fake_prices):  # noqa: F811
    async with _client() as c, _client() as other:
        h = await _token(c, "lots1@example.com")
        oh = await _token(other, "lots2@example.com")
        pid = await _portfolio(c, h, [(1, {})])
        old = await _add(c, h, pid, trade_date=_d(900), type="BUY", symbol="LOTB", quantity=10, price=100)
        new = await _add(c, h, pid, trade_date=_d(400), type="BUY", symbol="LOTB", quantity=10, price=300)
        await _add(c, h, pid, trade_date=_d(800), type="BUY", symbol="LOTC", quantity=5, price=50)

        lots = await c.get(f"/portfolio/{pid}/lots", headers=h, params={"symbol": "lotb", "on": _d(10)})
        assert lots.status_code == 200, lots.text
        assert [(x["buy_id"], x["quantity"]) for x in lots.json()["lots"]] == [(old["id"], 10), (new["id"], 10)]
        assert (await other.get(f"/portfolio/{pid}/lots", headers=oh, params={"symbol": "LOTB", "on": _d(10)})).status_code == 404

        sell = await _add(c, h, pid, trade_date=_d(10), type="SELL", symbol="LOTB", quantity=10, price=250,
                          lots=[{"buy_id": new["id"], "quantity": 10}])
        assert sell["lots"] == [{"buy_id": new["id"], "quantity": 10.0}] and sell["warnings"] == []
        summary = (await c.get(f"/portfolio/{pid}/ledger", headers=h)).json()
        assert [(x["open_date"], x["cost"]) for x in summary["realised_lots"]] == [(_d(400), 3000.0)]

        # The lot list for that day, without the sale itself, still shows both lots.
        again = await c.get(f"/portfolio/{pid}/lots", headers=h, params={"symbol": "LOTB", "on": _d(10), "exclude": sell["id"]})
        assert len(again.json()["lots"]) == 2

        cleared = await c.patch(f"/portfolio/{pid}/transactions/{sell['id']}", headers=h, json={"lots": None})
        assert cleared.status_code == 200 and cleared.json()["lots"] is None
        summary = (await c.get(f"/portfolio/{pid}/ledger", headers=h)).json()
        assert [x["open_date"] for x in summary["realised_lots"]] == [_d(900)]  # back to FIFO

        repick = await c.patch(f"/portfolio/{pid}/transactions/{sell['id']}", headers=h,
                               json={"lots": [{"buy_id": new["id"], "quantity": 10}]})
        assert repick.status_code == 200 and repick.json()["lots"][0]["buy_id"] == new["id"]


async def test_api_rejects_lots_that_are_not_buys_of_the_same_holding(fake_prices):  # noqa: F811
    async with _client() as c:
        h = await _token(c, "lots3@example.com")
        pid = await _portfolio(c, h, [(1, {})])
        b = await _add(c, h, pid, trade_date=_d(300), type="BUY", symbol="LOTD", quantity=5, price=10)
        other_symbol = await _add(c, h, pid, trade_date=_d(300), type="BUY", symbol="LOTA", quantity=5, price=10)
        other_account = await _add(c, h, pid, trade_date=_d(300), type="BUY", symbol="LOTD", quantity=5, price=10, account="IRA")

        for bad in (other_symbol["id"], other_account["id"], "00000000-0000-0000-0000-000000000000"):
            r = await c.post(f"/portfolio/{pid}/transactions", headers=h, json={
                "trade_date": _d(5), "type": "SELL", "symbol": "LOTD", "quantity": 1, "price": 12,
                "lots": [{"buy_id": bad, "quantity": 1}]})
            assert r.status_code == 422, r.text
        r = await c.post(f"/portfolio/{pid}/transactions", headers=h, json={
            "trade_date": _d(5), "type": "BUY", "symbol": "LOTD", "quantity": 1, "price": 12,
            "lots": [{"buy_id": b["id"], "quantity": 1}]})
        assert r.status_code == 422 and "Only a sale" in r.text

        dry = await c.post(f"/portfolio/{pid}/transactions/import", headers=h, json={"dry_run": True, "rows": [
            {"trade_date": _d(5), "type": "SELL", "symbol": "LOTD", "quantity": 1, "price": 12,
             "lots": [{"buy_id": other_symbol["id"], "quantity": 1}]}]})
        assert dry.status_code == 200 and dry.json()["errors"] and dry.json()["valid"] == 0
