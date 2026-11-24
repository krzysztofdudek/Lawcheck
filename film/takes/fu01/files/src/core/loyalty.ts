import { formatMoney } from "./money.ts";
import type { Customer } from "./price.ts";

export const LOYALTY_MIN_ORDERS = 5;
export const LOYALTY_PERCENT = 10;

export interface LoyaltyResult {
  totalCents: number;
  savedCents: number;
  message: string;
}

export function applyLoyaltyDiscount(customer: Customer, totalCents: number): LoyaltyResult {
  if (customer.orders <= LOYALTY_MIN_ORDERS) {
    return { totalCents, savedCents: 0, message: "" };
  }
  const savedCents = Math.round((totalCents * LOYALTY_PERCENT) / 100);
  return {
    totalCents: totalCents - savedCents,
    savedCents,
    message: `Loyalty discount: you saved ${formatMoney(savedCents)}`,
  };
}
