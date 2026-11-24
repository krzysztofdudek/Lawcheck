import assert from "node:assert/strict";
import { test } from "node:test";
import { lineTotal, orderTotal } from "../src/core/price.ts";

test("a line costs its price times its quantity", () => {
  assert.equal(lineTotal({ name: "tea", cents: 450, quantity: 3 }), 1350);
});

test("an order costs the sum of its lines", () => {
  assert.equal(orderTotal([{ name: "tea", cents: 450, quantity: 3 }, { name: "cup", cents: 1200, quantity: 1 }]), 2550);
});

test("an empty order costs nothing", () => {
  assert.equal(orderTotal([]), 0);
});
