export function refund(paid: boolean): number {
  if (!paid) throw new Error('The order is not paid yet; take the payment before a refund.');
  return 1;
}
