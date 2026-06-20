import { test } from "node:test";
import assert from "node:assert/strict";
import { getClosesForDays } from "./chartWindow";
import type { TickerChart } from "./types";

test("getClosesForDays filters by calendar-day timestamps when t is present", () => {
  const now = 1_781_827_200; // 2026-06-19T00:00:00Z
  const day = 86_400;
  const chart: TickerChart = {
    t: Array.from({ length: 8 }, (_, i) => now - (7 - i) * day),
    c: [10, 11, 12, 13, 14, 15, 16, 17],
  };

  const originalNow = Date.now;
  Date.now = () => (now + day / 2) * 1000;
  try {
    assert.deepEqual(getClosesForDays(chart, 7), [11, 12, 13, 14, 15, 16, 17]);
  } finally {
    Date.now = originalNow;
  }
});

test("getClosesForDays falls back to trailing bars when timestamps are missing", () => {
  const chart: TickerChart = {
    t: [],
    c: [1, 2, 3, 4, 5],
  };

  assert.deepEqual(getClosesForDays(chart, 3), [3, 4, 5]);
});
