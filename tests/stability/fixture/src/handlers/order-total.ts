import { orders } from '../services/orders';

export async function orderTotal(req: { params: { id: string } }) {
  const order = await orders.get(req.params.id);
  let total = 0;
  for (const line of order.lines) total += line.price * line.quantity;
  return { status: 200, body: { total } };
}
