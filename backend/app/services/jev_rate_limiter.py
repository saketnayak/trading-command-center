"""Shared async rate limiter for Alpaca calls.

Alpaca allows 200 requests/min per API key. The key is a single global
api_keys row, so every JEV Lab session shares one budget: limiter_for()
hands out one limiter per key id, process-wide.
"""

from __future__ import annotations

import asyncio
import collections
import time
from collections.abc import Awaitable, Callable

ALPACA_CALLS_PER_MINUTE = 180  # headroom under Alpaca's 200/min
_WINDOW_S = 60.0


class AsyncRateLimiter:
    def __init__(
        self,
        calls_per_minute: int,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.calls_per_minute = calls_per_minute
        self._clock = clock
        self._sleep = sleep
        self._stamps: collections.deque[float] = collections.deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = self._clock()
                while self._stamps and now - self._stamps[0] >= _WINDOW_S:
                    self._stamps.popleft()
                if len(self._stamps) < self.calls_per_minute:
                    self._stamps.append(now)
                    return
                await self._sleep(_WINDOW_S - (now - self._stamps[0]))


_limiters: dict[str, AsyncRateLimiter] = {}


def limiter_for(key_id: str) -> AsyncRateLimiter:
    if key_id not in _limiters:
        _limiters[key_id] = AsyncRateLimiter(ALPACA_CALLS_PER_MINUTE)
    return _limiters[key_id]
