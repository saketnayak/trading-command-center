"""Unit tests: training-cutoff labelling, backtest summaries, grids and the model leaderboard."""
from datetime import date, timedelta

import pytest

from app.services.backtest_calc import build_report, cutoff_for, decision_grid, leaderboard, sample_label, summarize

pytestmark = pytest.mark.unit


def _t(d, signal, r, bh=0.01, ticker="AAA", notes=""):
    return {"ticker": ticker, "decision_date": d, "signal": signal, "realised_return": r, "entry_price": 100.0,
            "exit_price": 101.0, "notes": notes,
            "benchmark_returns": {"buy_and_hold": bh, "always_hold": 0.0, "sma_crossover": 0.0, "random_baseline": -0.01}}


def test_cutoffs_match_by_longest_prefix():
    assert cutoff_for("gpt-4o-mini-2024-07-18") == "2023-10-01"
    assert cutoff_for("gpt-5-mini") == "2024-05-31" and cutoff_for("gpt-5") == "2024-09-30"
    assert cutoff_for("openai/gpt-4.1-nano") == "2024-06-01"
    assert cutoff_for("claude-sonnet-4-5-20250929") == "2025-07-01" and cutoff_for("claude-sonnet-4-20250514") == "2025-03-01"
    assert cutoff_for("my-local-model") is None
    assert cutoff_for("gpt-5.5") is None and cutoff_for("claude-sonnet-4-6") is None  # newer versions: unknown
    assert cutoff_for("gpt-4o-2024-08-06") == "2023-10-01" and cutoff_for("llama3.1:8b") == "2023-12-01"
    assert cutoff_for("gemini-2.5-pro") == "2025-01-01" and cutoff_for("gpt-4o-mini") == "2023-10-01"
    assert sample_label("2024-01-05", "2023-10-01") == "out_of_sample"
    assert sample_label("2023-10-01", "2023-10-01") == "in_sample" and sample_label("2023-01-01", None) == "unknown"


def test_summary_metrics():
    trades = [
        _t("2024-01-05", "BUY", 0.02, ticker="AAA"), _t("2024-01-05", "SELL", -0.01, ticker="BBB"),  # period: +0.5%
        _t("2024-01-12", "HOLD", 0.0, ticker="AAA"), _t("2024-01-12", "BUY", -0.02, ticker="BBB"),  # period: -1%
        _t("2024-01-19", "BUY", 0.03, ticker="AAA", notes="propagate error: boom"),  # left out
    ]
    s = summarize(trades)
    assert s["decisions"] == 4 and s["periods"] == 2 and s["signals"] == {"BUY": 2, "SELL": 1, "HOLD": 1}
    assert s["hit_rate"] == pytest.approx(1 / 3, abs=1e-4) and s["expectancy"] == pytest.approx(-0.01 / 3, abs=1e-6)
    assert s["total_return"] == pytest.approx(1.005 * 0.99 - 1, abs=1e-6)
    assert s["max_drawdown"] == pytest.approx(-0.01, abs=1e-6) and s["sharpe"] is not None
    assert s["benchmarks"]["buy_and_hold"]["total_return"] == pytest.approx(1.01 ** 2 - 1, abs=1e-6)
    assert s["excess_vs_buy_and_hold"] == pytest.approx(s["total_return"] - (1.01 ** 2 - 1), abs=1e-6)
    assert summarize([]) is None


def test_report_headlines_out_of_sample_only():
    trades = [_t("2023-06-02", "BUY", 0.05), _t("2023-06-09", "BUY", 0.04), _t("2024-02-02", "BUY", -0.01)]
    rep = build_report(trades, "weekly", "2023-10-01")
    assert rep["headline_basis"] == "out_of_sample" and rep["headline"]["decisions"] == 1
    assert rep["headline"]["total_return"] == pytest.approx(-0.01)
    assert rep["in_sample"]["total_return"] == pytest.approx(1.05 * 1.04 - 1)
    assert rep["counts"] == {"out_of_sample": 1, "in_sample": 2, "errors": 0, "total": 3}
    assert build_report(trades[:2], "weekly", "2023-10-01")["headline"] is None
    unknown = build_report(trades, "weekly", None)
    assert unknown["headline_basis"] == "all" and unknown["headline"]["decisions"] == 3 and "unknown" in unknown["note"]


def test_grid_matches_the_harness():
    assert decision_grid(date(2024, 1, 1), date(2024, 1, 31), "weekly") == [date(2024, 1, d) for d in (5, 12, 19, 26)]
    assert len(decision_grid(date(2024, 1, 1), date(2024, 1, 7), "daily")) == 5
    assert decision_grid(date(2024, 1, 1), date(2024, 1, 3), "weekly") == [date(2024, 1, 1), date(2024, 1, 2), date(2024, 1, 3)]


def test_leaderboard_groups_and_scores_against_spy():
    d0 = date(2026, 1, 5)
    spy = {d0: 100.0, d0 + timedelta(days=7): 101.0, d0 + timedelta(days=30): 102.0}
    base = {"provider": "openai", "model": "gpt-4o", "depth": "quick", "analysts": ["news", "market"], "analysis_date": d0,
            "price_at_analysis": 100.0, "price_7d": 103.0, "price_30d": 99.0}
    rows = [
        {**base, "verdict": "buy"},  # 7d: +3% (right), excess +2%; 30d: -1% (wrong), excess -3%
        {**base, "verdict": "sell", "price_7d": 97.0},  # 7d: +3% for a SELL (right), excess -(-3% - 1%) = +4%
        {**base, "verdict": "hold"},  # counted, not scored
        {**base, "verdict": "buy", "model": "claude-sonnet-4-5", "provider": "anthropic", "price_7d": None, "price_30d": None},
    ]
    out = leaderboard(rows, spy, "model")
    gpt = next(g for g in out if g["group"] == "openai · gpt-4o")
    assert gpt["runs"] == 3 and gpt["7d"]["scored"] == 2 and gpt["7d"]["accuracy"] == 1.0
    assert gpt["7d"]["avg_excess"] == pytest.approx((0.02 + 0.04) / 2)
    assert gpt["30d"]["accuracy"] == 0.5  # the BUY was wrong (99 < 100), the SELL right
    claude = next(g for g in out if g["group"].startswith("anthropic"))
    assert claude["7d"]["scored"] == 0 and claude["7d"]["accuracy"] is None
    assert [g["group"] for g in leaderboard(rows, spy, "analysts")] == ["market, news"]
    assert leaderboard(rows, {}, "depth")[0]["7d"]["avg_excess"] is None  # no SPY prices
