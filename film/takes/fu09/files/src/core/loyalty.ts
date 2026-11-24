import { formatMoney } from "./money.ts";
import type { Customer } from "./price.ts";

export const LOYALTY_MIN_ORDERS = 5;
export const LOYALTY_PERCENT = 10;

export interface LoyaltyResult {
  total: number;
  message: string;
}

/** A customer with more than five orders gets ten percent off. Amounts are in cents. */
export function applyLoyaltyDiscount(customer: Customer, totalCents: number): LoyaltyResult {
  if (customer.orders <= LOYALTY_MIN_ORDERS) {
    return { total: totalCents, message: "No loyalty discount" };
  }
  const saved = Math.round((totalCents * LOYALTY_PERCENT) / 100);
  return {
    total: totalCents - saved,
    message: `Loyalty discount: you saved ${formatMoney(saved)}`,
  };
}
