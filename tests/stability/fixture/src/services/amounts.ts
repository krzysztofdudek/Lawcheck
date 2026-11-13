export function checkAmount(amount: number): number {
  if (amount <= 0) throw new RangeError('amount must be greater than zero');
  return amount;
}
