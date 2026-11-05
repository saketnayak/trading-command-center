"""Learning loop: outcome maths, the /learning API and the reflection pass (LLM and prices faked),
plus hindsight flags on runs and the leaderboard leaving in-sample runs out."""
import asyncio
import json
import time
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.outcome import RunOutcome
from app.models.report import Report
from app.models.run import Run, RunStatus, RunVerdict
from app.models.user import User
from app.services import learning_service, price_history_service
from app.services.learning_service import outcome
from tests.test_portfolio_performance import TODAY, _client, _token

D = date(2026, 3, 2)  # a Monday


@pytest.mark.unit
def test_outcome_signs_by_verdict_and_rolls_back_over_weekends():
    # No close on D+28 or D+27: the exit rolls back to the latest close on or before, D+26.
    closes = {D: 100.0, D + timedelta(days=4): 110.0, D + timedelta(days=26): 90.0}
    out = outcome(closes, "buy", D, 28)
    assert out["entry_price"] == 100.0 and out["exit_price"] == 90.0 and out["realised_return"] == pytest.approx(-0.1)
    assert outcome(closes, "sell", D, 28)["realised_return"] == pytest.approx(0.1)
    hold = outcome(closes, "hold", D, 28)
    assert hold["realised_return"] == 0.0 and hold["stock_return"] == pytest.approx(-0.1)
    assert outcome({}, "buy", D, 7) is None
    assert outcome({D: 100.0}, "buy", D, 7) is None  # no later close: exit would equal entry


CALLS: list[dict] = []


def _fake_reflect(cfg, raw_state, out):
    CALLS.append({"cfg": cfg, "ticker": raw_state.get("company_of_interest"), "ret": out["realised_return"]})
    if raw_state.get("company_of_interest") == "BOOM":
        raise RuntimeError("model said no")
    mem = learning_service.memory_dir(cfg["results_dir"].rsplit("/", 1)[-1])
    mem.mkdir(parents=True, exist_ok=True)
    for name in learning_service.MEMORY_NAMES:
        with (mem / f"{name}.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"lesson": "x"}) + "\n")
    return {"trader": {"overall": 3}}


@pytest.fixture
def fakes(monkeypatch, tmp_path):
    CALLS.clear()
    monkeypatch.setenv("TRADINGAGENTS_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(learning_service, "_reflect", _fake_reflect)
    start = TODAY - timedelta(days=200)

    async def _closes(symbol, s):
        if symbol not in ("LRNA", "BOOM", "SPY"):
            raise ValueError("unknown")
        return {start + timedelta(days=i): 100.0 + i for i in range(201)}

    monkeypatch.setattr(price_history_service, "_download_closes", _closes)
    monkeypatch.setattr(price_history_service, "RETRY_DELAYS_S", (0.0,))
    price_history_service._recent_failures.clear()


async def _run(db, user_id, ticker, days_ago, *, model="lrn-model", verdict=RunVerdict.buy, report=True):
    run = Run(id=uuid.uuid4(), created_by=user_id, ticker=ticker, analysis_date=TODAY - timedelta(days=days_ago),
              llm_provider="ollama", llm_model=model, depth="quick", analysts=["market"], status=RunStatus.completed,
              verdict=verdict)
    db.add(run)
    await db.flush()
    if report:
        db.add(Report(run_id=run.id, verdict=verdict.value, trader_decision="x",
                      raw_report={"company_of_interest": ticker, "trade_date": str(run.analysis_date), "messages": []}))
    return run.id


async def _wait_idle(c, h, timeout=10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = (await c.get("/learning", headers=h)).json()
        if not body["running"]:
            return body
        await asyncio.sleep(0.05)
    raise AssertionError("pass still running")


async def test_learning_loop(fakes):
    async with _client() as c, _client() as other:
        h = await _token(c, "lrn1@example.com")
        oh = await _token(other, "lrn2@example.com")
        async with AsyncSessionLocal() as db:
            me = (await db.execute(select(User).where(User.email == "lrn1@example.com"))).scalar_one()
            them = (await db.execute(select(User).where(User.email == "lrn2@example.com"))).scalar_one()
            due = await _run(db, me.id, "LRNA", 60)
            await _run(db, me.id, "LRNA", 50, report=False)  # no saved state: skipped
            await _run(db, me.id, "BOOM", 45, verdict=RunVerdict.sell)  # reflection fails
            await _run(db, me.id, "LRNA", 3)  # not due yet
            await _run(db, them.id, "LRNA", 60)  # someone else's
            await db.commit()

        off = (await c.get("/learning", headers=h)).json()
        assert off["enabled"] is False and off["due"] is None and sum(off["memories"].values()) == 0
        assert (await c.post("/learning/run", headers=h)).status_code == 409
        assert await learning_service.live_results_dir(str(due)) is None  # off: shared default memories
        assert (await c.put("/learning", headers=h, json={"enabled": True, "horizon_days": 14})).status_code == 422
        on = (await c.put("/learning", headers=h, json={"enabled": True, "horizon_days": 30})).json()
        assert on["enabled"] and on["horizon_days"] == 30 and on["due"] == 3
        assert (await learning_service.live_results_dir(str(due))).endswith(f"/users/{me.id}")

        assert (await c.post("/learning/run", headers=h)).status_code == 202
        body = await _wait_idle(c, h)
        assert body["reflections"] == {"done": 1, "failed": 1, "skipped": 1} and body["due"] == 1  # the failure is retried
        assert all(n == 1 for n in body["memories"].values())
        statuses = {r["ticker"] + ":" + r["status"] for r in body["recent"]}
        assert statuses == {"LRNA:done", "LRNA:skipped", "BOOM:failed"}
        done = next(r for r in body["recent"] if r["status"] == "done")
        # Prices rise 1/day from 100: the 60-day-old BUY gained over its 30 days.
        assert done["realised_return"] > 0 and done["stock_return"] == done["realised_return"]
        failed = next(r for r in body["recent"] if r["status"] == "failed")
        assert "model said no" in failed["error"] and failed["realised_return"] < 0  # SELL into a rise
        assert all(call["cfg"]["results_dir"].endswith(str(me.id)) and call["cfg"]["depth"] == "quick" for call in CALLS)

        # A finished run is never reflected on again; a failed one is retried, up to 3 attempts.
        for attempt in (2, 3):
            assert (await c.post("/learning/run", headers=h)).status_code == 202
            body = await _wait_idle(c, h)
            assert body["reflections"] == {"done": 1, "failed": 1, "skipped": 1} and len(CALLS) == attempt + 1
            assert next(r for r in body["recent"] if r["ticker"] == "BOOM")["attempts"] == attempt
        assert body["due"] == 0
        assert (await c.post("/learning/run", headers=h)).status_code == 202
        await _wait_idle(c, h)
        assert len(CALLS) == 4  # no fourth attempt

        # Other users see nothing of it, and their own runs were untouched.
        theirs = (await other.get("/learning", headers=oh)).json()
        assert theirs["recent"] == [] and sum(theirs["memories"].values()) == 0

        assert (await c.delete("/learning/memories", headers=h)).status_code == 204
        assert sum((await c.get("/learning", headers=h)).json()["memories"].values()) == 0


async def test_hindsight_flags_and_leaderboard_exclusion(fakes):
    async with _client() as c:
        h = await _token(c, "lrn3@example.com")
        async with AsyncSessionLocal() as db:
            me = (await db.execute(select(User).where(User.email == "lrn3@example.com"))).scalar_one()
            old = Run(id=uuid.uuid4(), created_by=me.id, ticker="LRNA", analysis_date=date(2023, 3, 1), llm_provider="openai",
                      llm_model="gpt-4o-mini", depth="quick", analysts=["market"], status=RunStatus.completed, verdict=RunVerdict.buy)
            new = Run(id=uuid.uuid4(), created_by=me.id, ticker="LRNA", analysis_date=TODAY - timedelta(days=40),
                      llm_provider="openai", llm_model="gpt-4o-mini", depth="quick", analysts=["market"],
                      status=RunStatus.completed, verdict=RunVerdict.buy)
            db.add_all([old, new])
            await db.flush()
            for r in (old, new):
                db.add(RunOutcome(run_id=r.id, ticker="LRNA", verdict="buy", analysis_date=r.analysis_date.isoformat(),
                                  price_at_analysis=100.0, price_7d=105.0))
            await db.commit()
        a = (await c.get(f"/runs/{old.id}", headers=h)).json()
        b = (await c.get(f"/runs/{new.id}", headers=h)).json()
        assert a["training_cutoff"] == "2023-10-01" and a["hindsight_risk"] is True and b["hindsight_risk"] is False
        lb = (await c.get("/runs/leaderboard", headers=h)).json()
        assert lb["excluded_in_sample"] >= 1
        assert next(g for g in lb["groups"] if g["group"] == "openai · gpt-4o-mini")["runs"] == 1


@pytest.mark.unit
def test_reflection_config_is_complete(tmp_path):
    cfg = learning_service.ta_config({"results_dir": str(tmp_path), "provider": "groq", "model": "llama-3.3-70b", "depth": "deep"})
    assert cfg.llm_provider == "openai" and cfg.deep_think_llm == "llama-3.3-70b" and cfg.max_debate_rounds == 3
    assert str(cfg.data_cache_dir).startswith(str(tmp_path))
    assert learning_service.ta_config({"results_dir": str(tmp_path), "provider": "openai", "model": "m", "depth": None}).max_debate_rounds == 2
