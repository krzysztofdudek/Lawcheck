import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLoyaltyDiscount, lineTotal, orderTotal } from "../src/core/price.ts";

test("a line costs its price times its quantity", () => {
  assert.equal(lineTotal({ name: "tea", cents: 450, quantity: 3 }), 1350);
});

test("an order costs the sum of its lines", () => {
  assert.equal(orderTotal([{ name: "tea", cents: 450, quantity: 3 }, { name: "cup", cents: 1200, quantity: 1 }]), 2550);
});

test("an empty order costs nothing", () => {
  assert.equal(orderTotal([]), 0);
});

test("more than five orders earns ten percent off", () => {
  const r = applyLoyaltyDiscount(2550, { id: "c1", orders: 6 });
  assert.equal(r.totalCents, 2295);
  assert.equal(r.message, "Loyalty discount: you saved $2.55");
});

test("five orders or fewer earns no discount", () => {
  assert.deepEqual(applyLoyaltyDiscount(2550, { id: "c1", orders: 5 }), { totalCents: 2550, message: "" });
});
