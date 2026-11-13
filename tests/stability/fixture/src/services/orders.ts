import { db } from '../db';

export async function create(order: { items: unknown[] }) {
  const saved = await db.orders.insert(order);
  if (!saved) throw new Error('failed');
  return saved;
}
