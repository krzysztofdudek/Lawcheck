export function vat(net: number): number {
  return net * Number(process.env.VAT_RATE);
}
