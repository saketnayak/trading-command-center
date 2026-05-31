import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumericCell } from "./portfolioCsvFromImport";

test("parses comma thousands separators", () => {
  assert.equal(parseNumericCell("1,234"), 1234);
  assert.equal(parseNumericCell("1,234,567"), 1234567);
});

test("parses decimal commas", () => {
  assert.equal(parseNumericCell("12,34"), 12.34);
  assert.equal(parseNumericCell("1.234,56"), 1234.56);
});

test("parses english decimal with comma thousands separators", () => {
  assert.equal(parseNumericCell("1,234.56"), 1234.56);
});
