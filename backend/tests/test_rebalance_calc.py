"""Unit tests for the rebalancing maths (pure; no DB)."""
import pytest

from app.services.rebalance_calc import Position, Target, build_plan, drift, plan_amounts

pytestmark = pytest.mark.unit


def P(t, shares, price, fx=1.0, fractional=True):
    return Position(t, shares, price, fx, fractional)


# 60/40 today vs a 50/50 target, $10,000 total.
POS = {"A": P("A", 60, 100), "B": P("B", 40, 100)}
TGT = {"A": Target(0.5, 0.05), "B": Target(0.5, 0.05)}


def amounts(mode, pos=POS, tgt=TGT, amount=0.0):
    trades, left = plan_amounts(mode, pos, tgt, amount)
    return {k: round(v, 6) for k, v in trades.items()}, round(left, 6)


def test_drift_statuses():
    rows = {r["ticker"]: r for r in drift({**POS, "C": P("C", 0, 10)}, {**TGT, "C": Target(0.0, 0.05)})}
    assert rows["A"]["status"] == "over" and rows["A"]["drift"] == pytest.approx(0.10)
    assert rows["B"]["status"] == "under"
    untargeted = {r["ticker"]: r for r in drift({**POS, "X": P("X", 10, 10)}, TGT)}
    assert untargeted["X"]["status"] == "untargeted"
    wanted = {r["ticker"]: r for r in drift(POS, {**TGT, "N": Target(0.1, 0.05)})}
    assert wanted["N"]["status"] == "not_held"


def test_full_rebalance_is_self_financing():
    t, _ = amounts("full")
    assert t == {"A": -1000.0, "B": 1000.0}
    t, _ = amounts("full", amount=2000)  # rebalance and invest $2,000 → 6,000 each
    assert t == {"A": 0.0, "B": 2000.0}


def test_contribute_fills_the_biggest_deficit_first():
    t, _ = amounts("contribute", amount=1000)  # B is $1,000 short of 50% of 11,000 = 5,500 → gets it all
    assert t == {"A": 0.0, "B": 1000.0}
    t, _ = amounts("contribute", amount=4000)  # 14,000: A wants 7,000 (+1,000), B 7,000 (+3,000)
    assert t == {"A": 1000.0, "B": 3000.0}


def test_withdraw_sells_the_most_overweight_first_and_never_more_than_held():
    t, _ = amounts("withdraw", amount=1000)  # 9,000 left: A's excess over 4,500 is 1,500 ≥ 1,000, so only A sells
    assert t == {"A": -1000.0, "B": 0.0}
    t, _ = amounts("withdraw", amount=50_000)  # more than everything: sells it all
    assert t == {"A": -6000.0, "B": -4000.0}


def test_bands_mode_leaves_in_band_positions_alone():
    pos = {"A": P("A", 52, 100), "B": P("B", 48, 100)}  # inside ±5pp
    t, left = amounts("bands", pos=pos)
    assert t == {"A": 0.0, "B": 0.0} and left == 0


def test_bands_mode_funds_a_breach_from_in_band_excess():
    # A 30% (target 20, band 5 → breach), B 35% (target 40), C 35% (target 40): in band.
    pos = {"A": P("A", 30, 100), "B": P("B", 35, 100), "C": P("C", 35, 100)}
    tgt = {"A": Target(0.2, 0.05), "B": Target(0.4, 0.05), "C": Target(0.4, 0.05)}
    t, left = amounts("bands", pos=pos, tgt=tgt)
    # Selling A's 1,000 excess is absorbed by B and C's 500 deficits each.
    assert t == {"A": -1000.0, "B": 500.0, "C": 500.0} and left == 0


def test_bands_mode_reinvests_the_proceeds_of_an_untargeted_holding():
    # An untargeted holding is a breach (target 0), so it is sold. Targets sum to 100%,
    # so the in-band positions' deficits can always absorb the proceeds.
    pos = {"A": P("A", 50, 100), "B": P("B", 50, 100), "X": P("X", 10, 100)}
    tgt = {"A": Target(0.5, 0.10), "B": Target(0.5, 0.10)}
    t, left = amounts("bands", pos=pos, tgt=tgt)
    assert t["X"] == -1000.0
    # A and B are each $500 under 50% of 11,000, so they absorb it.
    assert t["A"] == 500.0 and t["B"] == 500.0 and left == 0
    assert sum(t.values()) == pytest.approx(0)


def test_plan_rows_shares_weights_and_summary():
    plan = build_plan("full", POS, TGT)
    assert [(r["ticker"], r["action"], r["amount"], r["shares"]) for r in plan["trades"]] == [
        ("A", "sell", 1000.0, 10.0), ("B", "buy", 1000.0, 10.0)]
    s = plan["summary"]
    assert s["buys"] == s["sells"] == 1000.0 and s["cash_left"] == 0
    assert s["turnover"] == pytest.approx(0.1)
    assert s["max_drift_before"] == pytest.approx(0.1) and s["max_drift_after"] == pytest.approx(0.0)
    assert plan["weights_after"] == {"A": 0.5, "B": 0.5}


def test_whole_shares_buys_round_down_sells_round_up_and_stay_funded():
    pos = {"A": P("A", 10, 333.0, fractional=False), "B": P("B", 0, 250.0, fractional=False)}
    tgt = {"A": Target(0.5, 0.05), "B": Target(0.5, 0.05)}
    plan = build_plan("full", pos, tgt, whole_shares=True)
    trades = {r["ticker"]: r for r in plan["trades"]}
    # Exact: sell 1665 of A (5.0 sh) and buy 1665 of B (6.66 sh) → sell 5, buy 6.
    assert trades["A"]["shares"] == 5 and trades["B"]["shares"] == 6
    assert plan["summary"]["cash_left"] >= 0


def test_fx_and_target_only_positions():
    # B is listed in a currency worth 2 display units, and not held yet.
    pos = {"A": P("A", 100, 10), "B": P("B", 0, 5, fx=2.0)}
    tgt = {"A": Target(0.5, 0.05), "B": Target(0.5, 0.05)}
    plan = build_plan("full", pos, tgt)
    b = next(r for r in plan["trades"] if r["ticker"] == "B")
    assert b["amount"] == 500.0 and b["shares"] == 50.0  # 500 / (5 × 2)


def test_tiny_trades_are_dropped():
    pos = {"A": P("A", 50.01, 100), "B": P("B", 49.99, 100)}
    assert build_plan("full", pos, TGT)["trades"] == []


def test_cent_rounding_never_shows_as_leftover_cash():
    # Without the guard these inputs report cash_left = 0.01: each trade amount is
    # rounded to cents, so a self-financing plan can be a cent off.
    pos = {"T0": P("T0", 29.836, 66.081), "T1": P("T1", 45.839, 237.553), "T2": P("T2", 29.252, 303.194)}
    tgt = {"T0": Target(0.4711, 0.01), "T1": Target(0.2433, 0.01), "T2": Target(0.2856, 0.01)}
    summary = build_plan("full", pos, tgt)["summary"]
    assert summary["cash_left"] == 0
    assert summary["buys"] == pytest.approx(summary["sells"], abs=0.02)
