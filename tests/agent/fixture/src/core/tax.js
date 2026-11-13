export function addTax(cents, rate) {
  if (rate < 0 || rate > 1) throw new Error(`rate must be between 0 and 1, got ${rate}`);
  return cents + Math.round(cents * rate);
}
