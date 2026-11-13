export function discount(tier: 'basic' | 'silver' | 'gold'): number {
  switch (tier) {
    case 'gold':
      return 0.15;
    case 'silver':
      return 0.05;
    default:
      return 0;
  }
}
