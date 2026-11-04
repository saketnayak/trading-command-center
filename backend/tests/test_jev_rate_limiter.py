import pytest

from app.services.jev_rate_limiter import AsyncRateLimiter, limiter_for

pytestmark = pytest.mark.unit


class FakeClock:
    def __init__(self):
        self.now = 1000.0
        self.slept: list[float] = []

    def time(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


async def test_calls_under_the_limit_never_wait():
    clock = FakeClock()
    limiter = AsyncRateLimiter(3, clock=clock.time, sleep=clock.sleep)
    for _ in range(3):
        await limiter.acquire()
    assert clock.slept == []


async def test_the_call_over_the_limit_waits_for_the_window_to_roll():
    clock = FakeClock()
    limiter = AsyncRateLimiter(2, clock=clock.time, sleep=clock.sleep)
    await limiter.acquire()
    clock.now += 10
    await limiter.acquire()
    await limiter.acquire()  # third call inside 60s: wait until the first ages out
    assert len(clock.slept) == 1
    assert clock.slept[0] == pytest.approx(50.0, abs=0.1)


def test_one_shared_limiter_per_key():
    assert limiter_for("PKAAA") is limiter_for("PKAAA")
    assert limiter_for("PKAAA") is not limiter_for("PKBBB")
