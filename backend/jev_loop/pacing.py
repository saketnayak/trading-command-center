"""Adaptive pacing for Jev calls.

Jev's upstream providers rate-limit per model and send no rate-limit
headers, so the loop cannot know its budget in advance. It learns it:
calls are spaced by an interval that doubles on a 429, grows more gently
on other errors, and shrinks back toward the minimum on success. Between
calls the loop keeps deciding on the latest answer while it is fresh.
"""

from __future__ import annotations


class JevPacer:
    def __init__(self, min_interval_s: float, answer_ttl_s: float, max_interval_s: float = 60.0):
        self.min_interval_s = min_interval_s
        self.max_interval_s = max_interval_s
        self.answer_ttl_s = answer_ttl_s
        self.interval_s = min_interval_s
        self._next_call_at: float | None = None
        self._answer = None
        self._answer_at: float | None = None

    def should_call(self, now: float) -> bool:
        return self._next_call_at is None or now >= self._next_call_at

    def cooldown_remaining(self, now: float) -> float:
        return 0.0 if self._next_call_at is None else max(0.0, self._next_call_at - now)

    def on_success(self, now: float, answers) -> None:
        self.interval_s = max(self.min_interval_s, self.interval_s * 0.8)
        self._next_call_at = now + self.interval_s
        self._answer, self._answer_at = answers, now

    def on_rate_limited(self, now: float, retry_after_s: float | None) -> None:
        self.interval_s = min(self.max_interval_s, self.interval_s * 2)
        self._next_call_at = now + max(self.interval_s, retry_after_s or 0.0)

    def on_error(self, now: float) -> None:
        self.interval_s = min(self.max_interval_s, self.interval_s * 1.5)
        self._next_call_at = now + self.interval_s

    def usable_answer(self, now: float):
        """(answers, age_s) while the last answer is within its TTL, else None."""
        if self._answer is None or self._answer_at is None:
            return None
        age = now - self._answer_at
        return (self._answer, age) if age <= self.answer_ttl_s else None
