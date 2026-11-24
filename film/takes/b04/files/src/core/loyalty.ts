import { formatMoney } from "./money.ts";

export const LOYALTY_MIN_ORDERS = 5;
export const LOYALTY_PERCENT = 10;

export interface LoyaltyResult {
  total: number;
  saved: number;
  message: string;
}

export function applyLoyaltyDiscount(totalCents: number, orders: number): LoyaltyResult {
  if (orders <= LOYALTY_MIN_ORDERS) {
    return { total: totalCents, saved: 0, message: "" };
  }
  const saved = Math.round((totalCents * LOYALTY_PERCENT) / 100);
  return {
    total: totalCents - saved,
    saved,
    message: `Loyalty discount: you saved ${formatMoney(saved)}`,
  };
}
