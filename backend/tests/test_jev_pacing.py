"""Adaptive Jev call pacing: spacing, back-off on 429s, answer reuse."""

import pytest

from jev_loop.pacing import JevPacer

pytestmark = pytest.mark.unit

A = {"regime": "answers"}


def test_the_first_call_is_allowed():
    assert JevPacer(min_interval_s=6, answer_ttl_s=12).should_call(100)


def test_calls_are_spaced_by_the_interval():
    p = JevPacer(min_interval_s=6, answer_ttl_s=12)
    p.on_success(100, A)
    assert not p.should_call(104)
    assert p.should_call(106)


def test_a_rate_limit_doubles_the_interval():
    p = JevPacer(min_interval_s=6, answer_ttl_s=12)
    p.on_rate_limited(100, retry_after_s=None)
    assert p.interval_s == 12
    assert not p.should_call(111) and p.should_call(112)


def test_retry_after_is_honoured_when_longer_than_the_interval():
    p = JevPacer(min_interval_s=6, answer_ttl_s=12)
    p.on_rate_limited(100, retry_after_s=30)
    assert not p.should_call(129) and p.should_call(130)
    assert p.cooldown_remaining(120) == pytest.approx(10)


def test_the_interval_is_capped():
    p = JevPacer(min_interval_s=6, answer_ttl_s=12, max_interval_s=60)
    for t in range(10):
        p.on_rate_limited(t, retry_after_s=None)
    assert p.interval_s == 60


def test_success_speeds_back_up_but_never_below_the_minimum():
    p = JevPacer(min_interval_s=6, answer_ttl_s=12)
    p.on_rate_limited(0, retry_after_s=None)  # 12
    p.on_success(20, A)
    assert 6 <= p.interval_s < 12
    for t in range(30, 300, 10):
        p.on_success(t, A)
    assert p.interval_s == 6


def test_other_errors_back_off_more_gently():
    p = JevPacer(min_interval_s=6, answer_ttl_s=12)
    p.on_error(0)
    assert 6 < p.interval_s < 12


def test_answers_are_reused_only_while_fresh():
    p = JevPacer(min_interval_s=6, answer_ttl_s=12)
    assert p.usable_answer(100) is None
    p.on_success(100, A)
    assert p.usable_answer(111) == (A, pytest.approx(11))
    assert p.usable_answer(113) is None
