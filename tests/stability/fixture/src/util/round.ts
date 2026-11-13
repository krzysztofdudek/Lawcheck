export function roundCents(amount: number): number {
  // the payment provider rejects amounts with more than two decimals
  return Math.round(amount * 100) / 100;
}
