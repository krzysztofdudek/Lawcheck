import { gateway } from '../gateway';

export async function charge(card: string, amount: number) {
  try {
    return await gateway.charge(card, amount);
  } catch (err) {
    console.error('gateway timeout', err);
    throw new Error('The payment gateway did not answer.');
  }
}
