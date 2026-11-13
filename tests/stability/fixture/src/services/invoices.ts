import { db } from '../db';

export async function pay(id: string, amount: number) {
  const invoice = await db.invoices.get(id);
  if (invoice.paid) throw new Error(`The invoice ${id} is already paid; issue a refund instead.`);
  return db.invoices.markPaid(id, amount);
}
