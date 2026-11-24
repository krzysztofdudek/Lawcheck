import { formatMoney } from "../api/format.ts";

export interface Line {
  name: string;
  cents: number;
  quantity: number;
}

export interface Customer {
  id: string;
  orders: number;
}

export function lineTotal(line: Line): number {
  return line.cents * line.quantity;
}

export function orderTotal(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

export interface DiscountResult {
  totalCents: number;
  message: string;
}

export function applyLoyaltyDiscount(totalCents: number, customer: Customer): DiscountResult {
  if (customer.orders <= 5) {
    return { totalCents, message: "" };
  }
  const savedCents = Math.round(totalCents * 0.1);
  return {
    totalCents: totalCents - savedCents,
    message: `Loyalty discount: you saved ${formatMoney(savedCents)}`,
  };
}
