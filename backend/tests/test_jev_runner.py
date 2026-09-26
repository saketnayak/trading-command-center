"""The nine-stage loop, driven against a fake broker and a scripted Jev."""

import asyncio

import pytest

from app.services.alpaca_paper_client import AlpacaAPIError
from app.services.jev_client import JevDeadlineExceeded, JevDecisionError, JevGatewayVerificationRequired, JevRateLimited
from app.services.jev_loop_runner import JevLoop, LoopConfig
from jev_loop.assets import resolve_symbol
from jev_loop.limits import Limits
from jev_loop.strategy import StrategyThresholds

pytestmark = pytest.mark.unit

BTC = resolve_symbol("BTC/USD")
AAPL = resolve_symbol("AAPL")


def answers(toxic=0.2, stressed=0.1, env=2.5, env_conf=0.9, direction="neutral", dconf=0.3, health=2.5):
    def score(s, c):
        return {"type": "score", "score": s, "probabilities": {"0": 0.1, "1": 0.2, "2": 0.3, "3": 0.4}, "confidence": c}

    return {
        "regime": {"type": "choice", "choice": "mean_reverting", "probabilities": {"mean_reverting": 1.0}, "confidence": 0.8},
        "direction": {"type": "choice", "choice": direction, "probabilities": {direction: 1.0}, "confidence": dconf},
        "toxic_flow": {"type": "noul", "noul": toxic},
        "liquidity_stressed": {"type": "noul", "noul": stressed},
        "quote_environment": score(env, env_conf),
        "inventory_pressure": score(0.5, 0.9),
        "execution_health": score(health, 0.9),
    }


class Clock:
    def __init__(self):
        self.now = 1_790_000_000.0

    def time(self):
        return self.now

    async def sleep(self, s):
        self.now += s


class FakeMarket:
    order_prefix = "jevlab-test-"

    def __init__(self, clock, spec=BTC, mid=100_000.0, is_open=True, equity="100000", venue_lag=0.0):
        self.clock, self.spec, self.mid, self.is_open, self.equity, self.venue_lag = clock, spec, mid, is_open, equity, venue_lag
        self.orders: list[dict] = []
        self.held = 0.0
        self.data_calls = 0
        self.cancel_calls = 0
        self.fail_reads = False
        self._seq = 0

    @property
    def orders_placed(self):
        return self._seq

    async def is_market_open(self):
        return self.is_open

    async def read_top_of_book(self):
        self.data_calls += 1
        if self.fail_reads:
            raise AlpacaAPIError(500, "boom")
        return [(self.mid - 5, 1.0)], [(self.mid + 5, 1.0)], self.clock.time() - self.venue_lag

    async def get_recent_trades(self, start_iso):
        return []

    async def get_minute_bars(self, start_iso):
        return []

    async def get_account(self):
        return {"equity": self.equity}

    def _new(self, side, qty, type_, price=None):
        self._seq += 1
        o = {"id": f"o{self._seq}", "client_order_id": f"{self.order_prefix}{self._seq}", "side": side,
             "qty": qty, "type": type_, "limit_price": price, "status": "new", "filled_qty": "0", "filled_avg_price": None}
        self.orders.append(o)
        return o

    async def submit_limit_order(self, side, qty, limit_price):
        return self._new(side, qty, "limit", limit_price)

    async def submit_market_order(self, side, qty):
        o = self._new(side, qty, "market")
        o.update(status="filled", filled_qty=str(qty), filled_avg_price=str(self.mid))
        self.held += qty if side == "buy" else -qty
        return o

    async def get_own_orders(self, after_iso):
        return list(self.orders)

    async def cancel_own_orders(self):
        self.cancel_calls += 1
        n = 0
        for o in self.orders:
            if o["status"] == "new":
                o["status"] = "canceled"
                n += 1
        return n

    async def get_position_qty(self):
        return self.held

    def open_orders(self):
        return [o for o in self.orders if o["status"] == "new"]


class Decider:
    is_mock = False
    name = "Scripted"
    model = "jev-test"

    def __init__(self, *script, clock=None, delay_s=0.0):
        self.script = list(script)
        self.calls = 0
        self.clock, self.delay_s = clock, delay_s

    async def ask(self, state, questions, timeout):
        self.calls += 1
        if self.clock is not None:
            self.clock.now += self.delay_s  # a slow Jev ages the data we decide on
        item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if isinstance(item, Exception):
            raise item
        return item, {"route": self.name, "model": self.model, "latency_ms": 90.0, "usage": {}, "cost_usd": 0.00003}


class Sink:
    def __init__(self):
        self.ticks: list[dict] = []
        self.statuses: list[tuple[str, str | None]] = []
        self.summaries: list[dict] = []

    async def on_tick(self, record, summary):
        self.ticks.append(record)
        self.summaries.append(summary)

    async def on_status(self, status, reason, summary):
        self.statuses.append((status, reason))
        self.summaries.append(summary)


def make_loop(market, decider, *, mode="paper", max_ticks=3, limits=None, thresholds=None, clock=None):
    clock = clock or market.clock
    cfg = LoopConfig(
        session_id="s1",
        spec=market.spec,
        mode=mode,
        limits=limits or Limits(),
        thresholds=thresholds or StrategyThresholds(),
        max_ticks=max_ticks,
        max_duration_s=3600,
    )
    sink = Sink()
    return JevLoop(cfg, market, decider, sink, clock=clock.time, sleep=clock.sleep, monotonic=clock.time), sink


async def test_shadow_mode_never_places_an_order_but_logs_the_plan():
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(answers(direction="up", dconf=0.9)), mode="shadow")
    assert await loop.run() == "completed"
    assert market.orders == [] and market.cancel_calls == 0
    assert len(sink.ticks) == 3
    assert all(o["status"] == "shadow" for t in sink.ticks for o in t["orders"])
    assert sink.ticks[0]["action"] == "QUOTE_BOTH_SIDES" and sink.ticks[0]["rung"] == "run"


async def test_a_mock_decider_forces_shadow_even_in_paper_mode():
    clock = Clock()
    market = FakeMarket(clock)
    decider = Decider(answers())
    decider.is_mock = True
    loop, _ = make_loop(market, decider, mode="paper")
    await loop.run()
    assert market.orders == []


async def test_paper_mode_on_a_flat_account_quotes_only_the_bid():
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(answers()), max_ticks=1)
    await loop.run()
    assert [(o["side"], o["type"]) for o in market.orders] == [("buy", "limit")]
    assert sink.ticks[0]["orders"][0]["status"] == "sent"


async def test_resting_quotes_are_not_replaced_every_tick():
    clock = Clock()
    market = FakeMarket(clock)
    loop, _ = make_loop(market, Decider(answers()), max_ticks=2)  # rest_ticks = 3
    await loop.run()
    assert len(market.orders) == 1


async def test_broker_fills_move_inventory_not_assumptions():
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(answers(direction="up", dconf=0.9)), max_ticks=2)
    await loop.run()
    assert sink.ticks[0]["inventory"] == 0.0  # the leg was only sent on tick 1
    assert sink.ticks[1]["inventory"] == pytest.approx(0.0002)  # read back on tick 2


async def test_late_answer_holds_and_pulls_resting_quotes():
    # Regression: upstream left stale quotes on the book while holding late.
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(answers(), JevDeadlineExceeded("slow")), max_ticks=2,
                           limits=Limits(jev_interval_s=2.0, jev_answer_ttl_s=0.5))
    await loop.run()
    assert sink.ticks[1]["rung"] == "hold_late"
    assert market.open_orders() == []


async def test_jev_outage_falls_back_to_rules_only():
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(JevDecisionError("down")), max_ticks=1, mode="shadow")
    await loop.run()
    assert sink.ticks[0]["rung"] == "rules_only"
    assert sink.ticks[0]["action"] == "QUOTE_WIDE"


async def test_gateway_card_403_in_shadow_mode_switches_to_the_mock():
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(JevGatewayVerificationRequired("add a card")), max_ticks=3, mode="shadow")
    await loop.run()
    assert market.orders == []
    assert sink.ticks[-1]["route"] == "MOCK"


async def test_gateway_card_403_fails_a_paper_session_instead_of_trading_on_the_mock():
    # Regression: a paper session silently ran on the mock for 56 minutes.
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(JevGatewayVerificationRequired("add a card")), max_ticks=5)
    assert await loop.run() == "failed"
    assert market.orders == []
    status, reason = sink.statuses[-1]
    assert status == "failed" and "card" in reason.lower()
    assert len(sink.ticks) == 1


async def test_jev_is_called_on_its_own_slower_schedule_and_answers_are_reused():
    clock = Clock()
    market = FakeMarket(clock)
    decider = Decider(answers())
    loop, sink = make_loop(market, decider, max_ticks=4, mode="shadow")  # 2 s ticks, 6 s Jev interval
    await loop.run()
    assert decider.calls == 2  # t=0 and t=6
    assert [t["jev_status"] for t in sink.ticks] == ["answered", "paced", "paced", "answered"]
    assert [t["answer_age_s"] for t in sink.ticks] == [0.0, 2.0, 4.0, 0.0]


async def test_a_rate_limit_backs_off_and_keeps_deciding_on_the_last_answer():
    clock = Clock()
    market = FakeMarket(clock)
    decider = Decider(answers(), JevRateLimited("429", retry_after_s=None), answers())
    loop, sink = make_loop(market, decider, max_ticks=4, mode="shadow", limits=Limits(jev_interval_s=2.0))
    await loop.run()
    # t=0 answered; t=2 429 (interval 2 -> 4); t=4 paced; t=6 answered
    assert [t["jev_status"] for t in sink.ticks] == ["answered", "rate_limited", "paced", "answered"]
    assert decider.calls == 3
    assert sink.ticks[1]["rung"] != "rules_only"  # reused the t=0 answer
    assert sink.ticks[1]["answer_age_s"] == 2.0


async def test_rules_only_once_the_last_answer_is_too_old():
    clock = Clock()
    market = FakeMarket(clock)
    decider = Decider(answers(), JevRateLimited("429", retry_after_s=60))
    loop, sink = make_loop(market, decider, max_ticks=9, mode="shadow")
    await loop.run()
    assert sink.ticks[-1]["rung"] == "rules_only"  # 16 s later, past the 12 s answer TTL
    assert decider.calls == 2  # the 60 s retry-after is honoured


async def test_a_reused_answer_never_repeats_the_directional_leg():
    clock = Clock()
    market = FakeMarket(clock)
    loop, _ = make_loop(market, Decider(answers(direction="up", dconf=0.9)), max_ticks=3)
    await loop.run()
    assert sum(1 for o in market.orders if o["type"] == "market") == 1


async def test_reused_answers_are_not_counted_for_calibration():
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(answers(direction="up", dconf=0.9)), max_ticks=2, mode="shadow")
    await loop.run()
    assert sink.ticks[0]["direction"] == "up" and sink.ticks[1]["direction"] is None


async def test_a_slow_jev_answer_makes_the_market_data_stale():
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(answers(), clock=clock, delay_s=6.0), max_ticks=1,
                           limits=Limits(max_decision_latency_ms=10_000_000))
    await loop.run()
    assert market.orders == []
    assert "stale" in sink.ticks[0]["action_reason"]


async def test_a_quiet_but_current_book_still_trades():
    # Regression: book-update age reached 156 s on a quiet Saturday; that is a
    # quiet venue, not stale data. It is reported (book_age_s), never vetoed.
    clock = Clock()
    market = FakeMarket(clock, venue_lag=150.0)
    loop, sink = make_loop(market, Decider(answers()), max_ticks=1)
    await loop.run()
    assert [o["side"] for o in market.orders] == ["buy"]
    assert not sink.ticks[0]["action_reason"].startswith("vetoed")
    assert sink.ticks[0]["snapshot"]["book_age_s"] == pytest.approx(150.0)


async def test_drawdown_kills_and_flattens_what_the_session_bought():
    clock = Clock()
    market = FakeMarket(clock, equity="100")
    decider = Decider(answers(direction="up", dconf=0.9), answers(direction="up", dconf=0.9), answers())
    loop, sink = make_loop(market, decider, max_ticks=10)

    original = market.read_top_of_book

    async def crash_after_first_tick():
        if market.data_calls >= 1:
            market.mid = 50_000.0
        return await original()

    market.read_top_of_book = crash_after_first_tick
    assert await loop.run() == "killed"
    assert market.orders[-1]["type"] == "market" and market.orders[-1]["side"] == "sell"
    assert market.held == pytest.approx(0.0)
    assert sink.statuses[-1][0] == "killed"


async def test_repeated_data_errors_trip_the_api_error_kill():
    # Regression: upstream skipped the tick on a data error, so this limit never fired.
    clock = Clock()
    market = FakeMarket(clock)
    market.fail_reads = True
    loop, sink = make_loop(market, Decider(answers()), max_ticks=50)
    assert await loop.run() == "killed"
    assert len(sink.ticks) == Limits().max_api_errors + 1


async def test_closed_equity_market_holds_without_reading_data():
    clock = Clock()
    market = FakeMarket(clock, spec=AAPL, is_open=False, mid=230.0)
    loop, sink = make_loop(market, Decider(answers()), max_ticks=2)
    await loop.run()
    assert market.data_calls == 0 and market.orders == []
    assert {t["action"] for t in sink.ticks} == {"MARKET_CLOSED"}


async def test_max_duration_completes_the_session():
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(answers()), max_ticks=None, mode="shadow")
    loop.cfg.max_duration_s = 10  # 2s ticks -> about 5 ticks
    assert await loop.run() == "completed"
    assert 4 <= len(sink.ticks) <= 6


async def test_stopping_cancels_this_sessions_resting_orders():
    clock = Clock()
    market = FakeMarket(clock)

    started = asyncio.Event()

    async def slow_sleep(s):
        started.set()
        await asyncio.sleep(3600)

    cfg_loop, sink = make_loop(market, Decider(answers()), max_ticks=None)
    cfg_loop._sleep = slow_sleep
    task = asyncio.create_task(cfg_loop.run())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert market.open_orders() == []
    assert sink.statuses[-1][0] == "stopped"


async def test_threshold_overrides_reach_the_policy():
    clock = Clock()
    market = FakeMarket(clock)
    loop, sink = make_loop(market, Decider(answers()), max_ticks=1, mode="shadow",
                           thresholds=StrategyThresholds(toxic_flow_pull_threshold=0.1))
    await loop.run()
    assert sink.ticks[0]["action"] == "PULL_QUOTES"


async def test_a_transient_account_read_failure_is_retried_at_startup():
    clock = Clock()
    market = FakeMarket(clock)
    real = market.get_account
    calls = {"n": 0}

    async def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise AlpacaAPIError(0, "network error: ReadTimeout")
        return await real()

    market.get_account = flaky
    loop, sink = make_loop(market, Decider(answers()), max_ticks=1, mode="shadow")
    assert await loop.run() == "completed"
    assert sink.summaries[-1]["start_equity_usd"] == 100000.0


async def test_a_crash_always_records_a_readable_reason():
    # Regression: ReadTimeout has an empty message, so the session failed with a blank reason.
    clock = Clock()
    market = FakeMarket(clock)

    async def boom():
        raise RuntimeError()

    market.read_top_of_book = boom
    loop, sink = make_loop(market, Decider(answers()), max_ticks=1, mode="shadow")
    assert await loop.run() == "failed"
    assert "RuntimeError" in sink.statuses[-1][1]
