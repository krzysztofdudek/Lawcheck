import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLoyaltyDiscount } from "../src/core/loyalty.ts";

test("more than five orders gets ten percent off", () => {
  assert.deepEqual(applyLoyaltyDiscount({ id: "a", orders: 6 }, 2550), {
    totalCents: 2295,
    savedCents: 255,
    message: "Loyalty discount: you saved $2.55",
  });
});

test("five orders or fewer gets no discount", () => {
  assert.equal(applyLoyaltyDiscount({ id: "a", orders: 5 }, 2550).totalCents, 2550);
});
