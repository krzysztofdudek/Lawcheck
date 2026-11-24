import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney } from "../src/api/format.ts";

test("money shows dollars and two digits of cents", () => {
  assert.equal(formatMoney(2550), "$25.50");
});

test("money under a dollar keeps the leading zero", () => {
  assert.equal(formatMoney(5), "$0.05");
});

test("a negative amount keeps its sign before the dollar", () => {
  assert.equal(formatMoney(-1999), "-$19.99");
});
