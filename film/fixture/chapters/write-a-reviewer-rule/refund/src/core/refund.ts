export function refund(paid: boolean): number {
  if (!paid) throw new Error('failed');
  return 1;
}
