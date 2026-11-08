import assert from "node:assert/strict";
import { test } from "node:test";

import { fmtMoney } from "./currency";

test("fmtMoney formats USD with two decimal places", () => {
  assert.equal(fmtMoney(1234.5, "USD"), "$1,234.50");
});

test("fmtMoney formats EUR with two decimal places", () => {
  assert.equal(fmtMoney(99.9, "EUR"), "€99.90");
});

test("fmtMoney formats JPY without fractional digits", () => {
  assert.doesNotThrow(() => fmtMoney(1500, "JPY"));
  assert.equal(fmtMoney(1500, "JPY"), "¥1,500");
});

test("fmtMoney falls back for non-ISO crypto quote currencies", () => {
  assert.doesNotThrow(() => fmtMoney(1234.5, "USDT"));
  assert.equal(fmtMoney(1234.5, "USDT"), "1,234.50 USDT");
});

test("fmtMoney shows KRW and ISK without decimals", () => {
  assert.equal(fmtMoney(1234.5, "KRW"), "₩1,235");
  assert.equal(fmtMoney(1234.5, "ISK"), "ISK\u00a01,235"); // Intl puts a no-break space after the code
});
