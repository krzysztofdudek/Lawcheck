import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLoyaltyDiscount } from "../src/core/loyalty.ts";

test("more than five orders gets ten percent off", () => {
  const result = applyLoyaltyDiscount({ id: "a", orders: 6 }, 2550);
  assert.equal(result.total, 2295);
  assert.equal(result.message, "Loyalty discount: you saved $2.55");
});

test("five orders or fewer pays full price", () => {
  const result = applyLoyaltyDiscount({ id: "a", orders: 5 }, 2550);
  assert.equal(result.total, 2550);
});
