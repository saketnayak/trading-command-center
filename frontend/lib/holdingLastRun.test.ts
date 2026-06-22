import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisFromLastRun } from "./holdingLastRun";

test("analysisFromLastRun returns null for missing last run", () => {
  assert.equal(analysisFromLastRun(null), null);
  assert.equal(analysisFromLastRun(undefined), null);
});

test("analysisFromLastRun normalizes verdict and maps analysis_date", () => {
  assert.deepEqual(
    analysisFromLastRun({
      run_id: "run-1",
      verdict: "BUY",
      analysis_date: "2026-06-01T12:00:00Z",
      suggested_entry: null,
      suggested_stop: null,
      suggested_target: null,
    }),
    {
      run_id: "run-1",
      verdict: "buy",
      completed_at: "2026-06-01T12:00:00Z",
    }
  );
});

test("analysisFromLastRun returns null when verdict is missing", () => {
  assert.equal(
    analysisFromLastRun({
      run_id: "run-1",
      verdict: null as unknown as string,
      analysis_date: "2026-06-01T12:00:00Z",
      suggested_entry: null,
      suggested_stop: null,
      suggested_target: null,
    }),
    null
  );
});

test("analysisFromLastRun rejects unknown verdict", () => {
  assert.equal(
    analysisFromLastRun({
      run_id: "run-1",
      verdict: "maybe",
      analysis_date: "2026-06-01T12:00:00Z",
      suggested_entry: null,
      suggested_stop: null,
      suggested_target: null,
    }),
    null
  );
});
