"""Integration tests: the Backtest Lab API and runner (the TradingAgents harness is faked),
plus the model leaderboard over live runs."""
import asyncio
import time
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.backtest import Backtest
from app.models.outcome import RunOutcome
from app.models.run import Run, RunStatus, RunVerdict
from app.models.user import User
from app.services import backtest_runner, price_history_service
from tests.test_portfolio_performance import TODAY, _client, _token

HARNESS = {"mode": "ok", "seen": []}


def _fake_harness(cfg, results_dir, on_trade):
    HARNESS["seen"].append({"cfg": cfg, "results_dir": results_dir})
    if HARNESS["mode"] == "fail":
        raise RuntimeError("graph exploded")
    from app.services.backtest_calc import decision_grid
    dates = decision_grid(date.fromisoformat(cfg["start_date"]), date.fromisoformat(cfg["end_date"]), cfg["frequency"])
    limit = 3 if HARNESS["mode"] == "budget" else None
    n = 0
    for d in dates:
        for i, t in enumerate(cfg["tickers"]):
            if limit is not None and n >= limit:
                return {"estimated_cost_usd": 4.9, "warning_rate": 0.0, "model_names": {"deep": cfg["llm_model"]}}
            if HARNESS["mode"] == "slow":
                time.sleep(0.15)
            on_trade({"ticker": t, "decision_date": d.isoformat(), "split": "test", "signal": "BUY" if i == 0 else "SELL",
                      "size_fraction": 0.2, "confidence": 0.6, "rationale": "fake", "entry_price": 100.0,
                      "exit_date": (d + timedelta(days=7)).isoformat(), "exit_price": 101.0,
                      "realised_return": 0.002 if i == 0 else -0.002,
                      "benchmark_returns": {"buy_and_hold": 0.002, "always_hold": 0.0, "sma_crossover": 0.0, "random_baseline": 0.0},
                      "notes": ""})
            n += 1
    return {"estimated_cost_usd": 0.0, "warning_rate": 0.0, "model_names": {"deep": cfg["llm_model"]}}


@pytest.fixture
def fake_harness(monkeypatch):
    HARNESS.update(mode="ok", seen=[])
    monkeypatch.setattr(backtest_runner, "_run_harness", _fake_harness)
    monkeypatch.setattr(backtest_runner, "PROGRESS_EVERY_S", 0.05)


async def _wait(c, h, bid, timeout=10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        bt = (await c.get(f"/backtests/{bid}", headers=h)).json()
        if bt["status"] not in ("pending", "running"):
            return bt
        await asyncio.sleep(0.05)
    raise AssertionError(f"backtest {bid} still {bt['status']}")


BASE = {"tickers": ["aapl", "msft"], "start_date": "2024-01-01", "end_date": "2024-01-31", "llm_model": "gpt-4o-mini"}


async def test_dry_run_scores_and_labels_out_of_sample(fake_harness):
    async with _client() as c, _client() as other:
        h = await _token(c, "bt1@example.com")
        oh = await _token(other, "bt2@example.com")
        meta = (await c.get("/backtests/meta", headers=h)).json()
        assert meta["model_cutoffs"]["gpt-4o-mini"] == "2023-10-01" and meta["limits"]["tickers"] == 5

        r = await c.post("/backtests", headers=h, json={**BASE, "analysts": ["market", "technical", "news"]})
        assert r.status_code == 201, r.text
        created = r.json()
        assert created["total_decisions"] == 8 and created["config"]["tickers"] == ["AAPL", "MSFT"]
        assert created["config"]["training_cutoff"] == "2023-10-01" and created["config"]["cutoff_source"] == "table"
        assert created["config"]["reflect"] is False and created["config"]["analysts"] == ["market", "news"]
        assert "(dry run)" in created["name"]

        bt = await _wait(c, h, created["id"])
        assert bt["status"] == "completed" and bt["done"] == 8 and bt["error"] is None
        rep = bt["report"]
        assert rep["headline_basis"] == "out_of_sample" and rep["counts"]["out_of_sample"] == 8
        assert rep["headline"]["signals"] == {"BUY": 4, "SELL": 4, "HOLD": 0} and rep["headline"]["hit_rate"] == 0.5
        assert bt["headline"]["total_return"] == pytest.approx(0.0, abs=1e-9)
        assert HARNESS["seen"][0]["results_dir"].startswith("/") and "backtest-" in HARNESS["seen"][0]["results_dir"]

        listed = (await c.get("/backtests", headers=h)).json()
        assert [b["id"] for b in listed] == [created["id"]] and "trades" not in listed[0]
        assert (await other.get(f"/backtests/{created['id']}", headers=oh)).status_code == 404
        assert (await other.get("/backtests", headers=oh)).json() == []

        # A user-supplied cutoff after the dates makes every decision in-sample: no headline.
        r = await c.post("/backtests", headers=h, json={**BASE, "training_cutoff": "2024-06-01"})
        bt = await _wait(c, h, r.json()["id"])
        assert bt["config"]["cutoff_source"] == "you" and bt["report"]["headline_basis"] == "none"
        assert bt["report"]["headline"] is None and bt["report"]["in_sample"]["decisions"] == 8

        assert (await c.delete(f"/backtests/{created['id']}", headers=h)).status_code == 204
        assert (await c.get(f"/backtests/{created['id']}", headers=h)).status_code == 404


async def test_abort_budget_stop_failure_and_recovery(fake_harness):
    async with _client() as c:
        h = await _token(c, "bt3@example.com")
        HARNESS["mode"] = "slow"
        bid = (await c.post("/backtests", headers=h, json=BASE)).json()["id"]
        for _ in range(100):
            if (await c.get(f"/backtests/{bid}", headers=h)).json()["done"] >= 1:
                break
            await asyncio.sleep(0.05)
        assert (await c.delete(f"/backtests/{bid}", headers=h)).status_code == 409  # still running
        assert (await c.post(f"/backtests/{bid}/abort", headers=h)).status_code == 202
        bt = await _wait(c, h, bid)
        assert bt["status"] == "aborted" and 1 <= bt["done"] < 8 and "Stopped by you" in bt["error"]
        assert bt["report"]["counts"]["total"] == bt["done"]
        assert (await c.post(f"/backtests/{bid}/abort", headers=h)).status_code == 409

        HARNESS["mode"] = "budget"  # a real run on a keyless local provider, cut short by the cap
        r = await c.post("/backtests", headers=h, json={**BASE, "dry_run": False, "budget_usd": 5, "llm_provider": "ollama",
                                                        "llm_model": "llama3.1"})
        assert r.status_code == 201, r.text
        bt = await _wait(c, h, r.json()["id"])
        assert bt["status"] == "stopped" and bt["done"] == 3 and "budget cap" in bt["error"]
        assert bt["cost_usd"] == pytest.approx(4.9) and bt["config"]["reflect"] is True

        HARNESS["mode"] = "fail"
        bt = await _wait(c, h, (await c.post("/backtests", headers=h, json=BASE)).json()["id"])
        assert bt["status"] == "failed" and "graph exploded" in bt["error"] and bt["report"] is None

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == "bt3@example.com"))).scalar_one()
        stuck = Backtest(user_id=user.id, name="stuck", status="running", config={"frequency": "weekly", "training_cutoff": None},
                         total_decisions=4, trades=[{"ticker": "AAA", "decision_date": "2024-01-05", "signal": "BUY",
                                                     "realised_return": 0.01, "entry_price": 1.0, "exit_price": 1.01,
                                                     "benchmark_returns": {}, "notes": ""}])
        db.add(stuck)
        await db.commit()
        stuck_id = stuck.id
    await backtest_runner.recover_interrupted_backtests()
    async with AsyncSessionLocal() as db:
        row = await db.get(Backtest, stuck_id)
        assert row.status == "interrupted" and row.report["headline"]["decisions"] == 1


async def test_validation(fake_harness):
    async with _client() as c:
        h = await _token(c, "bt4@example.com")
        recent = (TODAY - timedelta(days=2)).isoformat()
        cases = [
            ({**BASE, "tickers": ["$$"]}, "Invalid ticker"),
            ({**BASE, "start_date": "2024-02-01"}, "on or before"),
            ({**BASE, "end_date": recent, "start_date": (TODAY - timedelta(days=20)).isoformat()}, "trading days of prices"),
            ({**BASE, "start_date": "2022-01-01", "end_date": "2023-12-31", "frequency": "daily"}, "the limit is"),
            ({**BASE, "dry_run": False, "llm_provider": "ollama"}, "budget cap"),
            ({**BASE, "dry_run": False, "budget_usd": 5, "llm_provider": "openai"}, "API key"),
            ({**BASE, "start_date": "1999-01-01", "end_date": "1999-02-01"}, "2000 or later"),
        ]
        for body, msg in cases:
            r = await c.post("/backtests", headers=h, json=body)
            assert r.status_code == 422 and msg in r.json()["detail"], (body, r.text)
        assert (await c.post("/backtests", headers=h, json={**BASE, "tickers": ["A", "B", "C", "D", "E", "F"]})).status_code == 422
        assert (await c.post("/backtests", headers=h, json={**BASE, "budget_usd": 500})).status_code == 422


async def test_model_leaderboard(monkeypatch):
    spy_start = TODAY - timedelta(days=200)

    async def _closes(symbol, start):
        if symbol != "SPY":
            raise ValueError("unknown")
        return {spy_start + timedelta(days=i): 100.0 + i * 0.1 for i in range(201)}

    monkeypatch.setattr(price_history_service, "_download_closes", _closes)
    monkeypatch.setattr(price_history_service, "RETRY_DELAYS_S", (0.0,))
    price_history_service._recent_failures.clear()
    async with _client() as c:
        h = await _token(c, "bt5@example.com")
        async with AsyncSessionLocal() as db:
            user = (await db.execute(select(User).where(User.email == "bt5@example.com"))).scalar_one()
            d0 = TODAY - timedelta(days=100)
            for model, verdict, p7 in (("lb-model-a", RunVerdict.buy, 110.0), ("lb-model-a", RunVerdict.buy, 90.0),
                                       ("lb-model-b", RunVerdict.sell, 95.0)):
                run = Run(id=uuid.uuid4(), created_by=user.id, ticker="LBX", analysis_date=d0, llm_provider="openai",
                          llm_model=model, depth="quick", analysts=["market"], status=RunStatus.completed, verdict=verdict)
                db.add(run)
                await db.flush()
                db.add(RunOutcome(run_id=run.id, ticker="LBX", verdict=verdict.value, analysis_date=d0.isoformat(),
                                  price_at_analysis=100.0, price_7d=p7))
            await db.commit()
        body = (await c.get("/runs/leaderboard?group_by=model", headers=h)).json()
        groups = {g["group"]: g for g in body["groups"]}
        a, b = groups["openai · lb-model-a"], groups["openai · lb-model-b"]
        assert a["runs"] == 2 and a["7d"]["accuracy"] == 0.5 and b["7d"]["accuracy"] == 1.0
        assert body["benchmark_available"] is True and b["7d"]["avg_excess"] is not None
        assert (await c.get("/runs/leaderboard?group_by=nope", headers=h)).status_code == 422
