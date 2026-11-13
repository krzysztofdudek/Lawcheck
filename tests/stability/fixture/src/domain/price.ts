export function gross(net: number, rate: number): number {
  return net * (1 + rate);
}
