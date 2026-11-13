import { ShopError } from '../core/errors.js';
import { parsePrice } from '../core/price.js';
import { addTax } from '../core/tax.js';

try {
  const cents = addTax(parsePrice(process.argv[2] ?? '0'), Number(process.argv[3] ?? '0.23'));
  console.log((cents / 100).toFixed(2));
} catch (error) {
  if (!(error instanceof ShopError)) throw error;
  console.error(error.message);
  process.exitCode = 2;
}
