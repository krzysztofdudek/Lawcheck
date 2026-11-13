import { db } from '../db';

export async function rateFor(code: string, day: string): Promise<number> {
  const rate = await db.rates.find(code, day);
  if (rate === undefined) throw new Error(`No exchange rate for ${code} on ${day}; rates are published at 16:00 CET.`);
  return rate;
}
