import assert from "node:assert/strict";
import { test } from "node:test";
import { receipt } from "../src/api/orders.ts";

test("a receipt lists each line and the total", () => {
  assert.deepEqual(receipt([{ name: "tea", cents: 450, quantity: 3 }, { name: "cup", cents: 1200, quantity: 1 }]), ["3 x tea  $13.50", "1 x cup  $12.00", "Total  $25.50"]);
});

test("a receipt of one line still ends with the total", () => {
  assert.deepEqual(receipt([{ name: "tea", cents: 450, quantity: 1 }]), ["1 x tea  $4.50", "Total  $4.50"]);
});
