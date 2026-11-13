const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

export function formatAmount(amount: number): string {
  return pln.format(amount);
}
