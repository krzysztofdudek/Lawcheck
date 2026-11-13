import { orders } from '../services/orders';

export async function createOrder(req: { body: { items?: unknown } }) {
  if (!Array.isArray(req.body.items)) return { status: 400, body: 'items must be a list' };
  const order = await orders.create(req.body);
  return { status: 201, body: order };
}
