import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeSeconds } from "./formatRelativeTime";

test("formatRelativeSeconds returns just now for recent timestamps", () => {
  assert.equal(formatRelativeSeconds(0), "just now");
  assert.equal(formatRelativeSeconds(4), "just now");
});

test("formatRelativeSeconds formats seconds, minutes, hours, and days", () => {
  assert.equal(formatRelativeSeconds(30), "30s ago");
  assert.equal(formatRelativeSeconds(90), "1m ago");
  assert.equal(formatRelativeSeconds(7200), "2h ago");
  assert.equal(formatRelativeSeconds(172800), "2d ago");
});
