"""Unit tests for compound alert rules and the compiler's pure helpers (no DB, no LLM)."""
from datetime import date

import pytest

from app.services import alert_compiler, alert_compound
from app.services.alert_rules import RuleParamError, evaluate, rule_scope, rule_tickers, validate_params

pytestmark = pytest.mark.unit

BEAR_AND_BELOW_200 = {
    "op": "and", "scope": "holdings", "sectors": ["Semiconductors"],
    "conditions": [{"type": "regime", "regime": "Bear"}, {"type": "ma", "window": 200, "direction": "below"}],
}


def _r(regime=None, close=None, sma=None, **extra):
    out = dict(extra)
    if regime is not None:
        out["regime"] = regime
    if close is not None:
        out["ma200"] = {"close": close, "sma": sma, "date": "2026-11-04"}
    return out


# ── validation ────────────────────────────────────────────────────────────────

def test_compound_validation_defaults_and_scope_rules():
    p = validate_params("compound", {"conditions": [{"type": "ma"}]})
    assert p == {"op": "and", "scope": "ticker", "sectors": [],
                 "conditions": [{"type": "ma", "window": 200, "direction": "below"}]}
    assert rule_scope("compound", p) == "ticker"
    assert rule_scope("compound", validate_params("compound", BEAR_AND_BELOW_200)) == "portfolio"
    assert rule_scope("price_above", {"price": 1}) == "ticker"

    v = validate_params("compound", {"conditions": [{"type": "verdict", "verdict": "SELL"}],
                                     "scope": "holdings", "sectors": [" Health  Care ", "health care", ""]})
    assert v["conditions"][0]["verdict"] == "sell" and v["sectors"] == ["Health Care"]

    bad = [
        {"conditions": []},
        {"conditions": [{"type": "ma"}] * 6},
        {"conditions": [{"type": "moon"}]},
        {"conditions": [{"type": "regime", "regime": "Crab"}]},
        {"conditions": [{"type": "price_above", "price": 10}], "scope": "holdings"},  # a level per holding is meaningless
        {"conditions": [{"type": "ma"}], "sectors": ["Energy"]},  # sector filter needs holdings
        {"conditions": [{"type": "daily_move", "pct": 0}]},
        {"op": "xor", "conditions": [{"type": "ma"}]},
    ]
    for params in bad:
        with pytest.raises(RuleParamError):
            validate_params("compound", params)
    with pytest.raises(RuleParamError, match="single ticker"):
        validate_params("compound", {"conditions": [{"type": "price_below", "price": 5}], "scope": "holdings"})


def test_needs_portfolio_and_event_tickers():
    assert alert_compound.needs_portfolio({"scope": "holdings", "conditions": []})
    assert alert_compound.needs_portfolio({"scope": "ticker", "conditions": [{"type": "weight_above", "pct": 5}]})
    assert not alert_compound.needs_portfolio({"scope": "ticker", "conditions": [{"type": "ma"}]})
    assert rule_tickers("compound", {"matched": ["NVDA", "AMD"]}, None) == ["NVDA", "AMD"]
    assert rule_tickers("position_weight", {"new": ["AAA"]}, None) == ["AAA"]
    assert rule_tickers("price_above", {}, "MSFT") == ["MSFT"]
    assert rule_tickers("portfolio_drawdown", {}, None) == []


def test_sector_matching_is_forgiving_but_not_loose():
    m = alert_compound.sector_matches
    assert m("Technology", "Semiconductors", ["semiconductor"])
    assert m("Healthcare", None, ["Health Care"])
    assert m("Technology", "Software", ["Information Technology"])
    assert m("Financial Services", "Banks - Diversified", ["banks"])
    assert not m("Energy", "Oil & Gas", ["Semiconductors"])
    assert not m(None, None, ["Technology"])  # unknown sector never matches a filter
    assert m(None, None, [])  # no filter: everything


# ── three-valued logic ───────────────────────────────────────────────────────

def test_combine_is_kleene_logic():
    c = alert_compound.combine
    assert c("and", [True, True]) is True
    assert c("and", [True, None]) is None
    assert c("and", [False, None]) is False
    assert c("or", [False, None]) is None
    assert c("or", [None, True]) is True
    assert c("or", [False, False]) is False
    assert alert_compound.decided("and", [None, False]) and not alert_compound.decided("and", [True])
    assert alert_compound.decided("or", [True]) and not alert_compound.decided("or", [False, None])


def test_condition_checks():
    chk = alert_compound.check_condition
    assert chk({"type": "daily_move", "pct": 5, "direction": "down"}, {"quote": {"price": 9, "change_pct": -6.0}})[0] is True
    assert chk({"type": "daily_move", "pct": 5, "direction": "down"}, {"quote": {"price": 9, "change_pct": 6.0}})[0] is False
    assert chk({"type": "daily_move", "pct": 5, "direction": "any"}, {"quote": {"price": 9, "change_pct": -5.0}})[0] is True
    assert chk({"type": "daily_move", "pct": 5}, {"quote": {"price": 9, "change_pct": None}})[0] is None
    assert chk({"type": "price_above", "price": 10}, {"quote": {"price": 11}}) == (True, "price 11.00")
    assert chk({"type": "ma", "window": 50, "direction": "above"}, {"ma50": {"close": 9, "sma": 10}})[0] is False
    assert chk({"type": "verdict", "verdict": "sell"}, {"verdict": "SELL"})[0] is True
    assert chk({"type": "weight_above", "pct": 20}, {"weight": 0.25}) == (True, "25.0% of the portfolio")
    assert chk({"type": "regime", "regime": "Bear"}, {"regime": None}) == (None, "Bear regime: no data")
    assert chk({"type": "regime", "regime": "Bear"}, {}) == (None, "Bear regime: not checked")


# ── evaluation and firing ────────────────────────────────────────────────────

def test_holdings_rule_fires_per_newly_matching_ticker_and_rearms():
    p = validate_params("compound", BEAR_AND_BELOW_200)
    obs = {"readings": {"NVDA": _r("Bear", 100, 120), "AMD": _r("Bull"), "AVGO": _r("Bear", 200, 150)},
           "excluded": ["JNJ"]}
    first = evaluate("compound", p, obs, None, portfolio_name="Core")
    assert first.fire and first.condition is True
    assert first.data["matched"] == ["NVDA"]
    assert first.title == "NVDA: Bear regime and below its 200-day average"
    assert "Semiconductors holdings in Core" in first.message and "close 100.00 vs 200-day 120.00" in first.message
    assert first.observed == "1 of 3 holdings match: NVDA; 1 holding outside the sector filter"

    # NVDA still matches: quiet. AVGO starts matching: fires for AVGO only.
    obs["readings"]["AVGO"] = _r("Bear", 140, 150)
    second = evaluate("compound", p, obs, first.state, portfolio_name="Core")
    assert second.fire and second.data["matched"] == ["AVGO"]
    third = evaluate("compound", p, obs, second.state, portfolio_name="Core")
    assert not third.fire and third.condition is True

    # NVDA recovers above its average (re-arms), then falls back below: fires again.
    obs["readings"]["NVDA"] = _r("Bear", 130, 120)
    rearm = evaluate("compound", p, obs, third.state, portfolio_name="Core")
    assert not rearm.fire and rearm.state["tickers"]["NVDA"]["active"] is False
    obs["readings"]["NVDA"] = _r("Bear", 110, 120)
    again = evaluate("compound", p, obs, rearm.state, portfolio_name="Core")
    assert again.fire and again.data["matched"] == ["NVDA"]


def test_unknown_readings_neither_fire_nor_rearm():
    p = validate_params("compound", {"conditions": [{"type": "regime", "regime": "Bear"},
                                                    {"type": "ma", "window": 200, "direction": "below"}]})
    on = evaluate("compound", p, {"readings": {"TSLA": _r("Bear", 1, 2)}}, None, ticker="TSLA")
    assert on.fire and on.title == "TSLA: Bear regime and below its 200-day average"
    gap = evaluate("compound", p, {"readings": {"TSLA": {"regime": None, "ma200": None}}}, on.state, ticker="TSLA")
    assert gap.condition is None and not gap.fire and gap.state["tickers"]["TSLA"]["active"] is True
    back = evaluate("compound", p, {"readings": {"TSLA": _r("Bear", 1, 2)}}, gap.state, ticker="TSLA")
    assert not back.fire  # the gap did not re-arm it
    assert evaluate("compound", p, None, back.state).condition is None


def test_or_rule_and_short_circuited_readings():
    p = validate_params("compound", {"op": "or", "conditions": [{"type": "verdict", "verdict": "sell"},
                                                                {"type": "regime", "regime": "Bear"}]})
    # The engine stops fetching once OR is decided: regime was never fetched.
    ev = evaluate("compound", p, {"readings": {"META": {"verdict": "sell"}}}, None, ticker="META")
    assert ev.fire and ev.observed == "verdict SELL"
    assert ev.title == "META: AI verdict SELL or Bear regime"
    none = evaluate("compound", p, {"readings": {"META": {"verdict": "buy", "regime": "Bull"}}}, ev.state, ticker="META")
    assert none.condition is False and none.state["tickers"]["META"]["active"] is False


def test_daily_move_rearms_each_session():
    p = validate_params("compound", {"conditions": [{"type": "daily_move", "pct": 5, "direction": "down"}]})
    day1 = {"readings": {"XOM": {"quote": {"price": 90, "change_pct": -6.0, "prev_close": 95.7}}}}
    a = evaluate("compound", p, day1, None, ticker="XOM")
    assert a.fire
    # Next session opens down again: still "true", but a new previous close re-arms the ticker.
    day2 = {"readings": {"XOM": {"quote": {"price": 84, "change_pct": -6.7, "prev_close": 90.0}}}}
    b = evaluate("compound", p, day2, a.state, ticker="XOM")
    assert b.fire
    assert not evaluate("compound", p, day2, b.state, ticker="XOM").fire


def test_empty_scope_and_dropped_holdings():
    p = validate_params("compound", BEAR_AND_BELOW_200)
    empty = evaluate("compound", p, {"readings": {}, "excluded": ["JNJ"]}, None)
    assert empty.condition is None and empty.observed == "No holdings match the scope"
    first = evaluate("compound", p, {"readings": {"NVDA": _r("Bear", 1, 2)}}, None)
    sold = evaluate("compound", p, {"readings": {"AMD": _r("Bull")}}, first.state)
    assert set(sold.state["tickers"]) == {"AMD"}  # a sold holding's memory is dropped


# ── compiler helpers ─────────────────────────────────────────────────────────

def test_parse_reply_tolerates_fences_and_rejects_garbage():
    raw = 'Sure!\n```json\n{"rule": {"kind": "price_above", "ticker": "NVDA", "params": {"price": 150}}, "unsupported": ["x" ]}\n```'
    out = alert_compiler.parse_reply(raw)
    assert out["rule"]["kind"] == "price_above" and out["unsupported"] == ["x"]
    assert alert_compiler.parse_reply('{"rule": null, "unsupported": "missing: a price"}') == {
        "rule": None, "unsupported": ["missing: a price"]}
    for bad in ("", "no json here", "{not json}", '{"rule": "price_above"}', "[1, 2]"):
        with pytest.raises(alert_compiler.CompileError):
            alert_compiler.parse_reply(bad)


def test_tidy_params_and_match_portfolio():
    tidy = alert_compiler.tidy_params({"window": "200", "direction": "Below", "to": "BEAR"})
    assert tidy == {"window": 200, "direction": "below", "to": "Bear"}
    nested = alert_compiler.tidy_params({"op": "AND", "conditions": [{"type": "Regime", "regime": "bear"},
                                                                     {"type": "daily_move", "pct": "5%"}]})
    assert nested["op"] == "and" and nested["conditions"] == [{"type": "regime", "regime": "Bear"},
                                                              {"type": "daily_move", "pct": 5.0}]
    assert alert_compiler.tidy_params("nope") == {}
    ps = [("id-1", "Core"), ("id-2", "Income")]
    assert alert_compiler.match_portfolio("core", ps) == ("id-1", None)
    assert alert_compiler.match_portfolio("id-2", ps) == ("id-2", None)
    assert alert_compiler.match_portfolio(None, ps) == (None, None)
    assert alert_compiler.match_portfolio("Growth", ps) == (None, "You have no portfolio called 'Growth'.")


def test_prompt_carries_the_dsl_portfolios_and_request():
    prompt = alert_compiler.build_prompt('semis go "Bear"', ["Core"], date(2026, 11, 5))
    assert '"semis go \\"Bear\\""' in prompt  # the request is quoted, not spliced in raw
    assert '["Core"]' in prompt and "2026-11-05" in prompt
    for kind in ("compound", "weight_above", "regime_change", "rerun_analysis"):
        assert kind in prompt
