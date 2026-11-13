export function parsePrice(text) {
  const [whole, cents = '0'] = text.split('.');
  return Number(whole) * 100 + Number(cents.padEnd(2, '0').slice(0, 2));
}
