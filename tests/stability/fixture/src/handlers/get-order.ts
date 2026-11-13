import { orders } from '../services/orders';

export async function getOrder(req: { params: { id: string } }) {
  const order = await orders.get(req.params.id);
  if (order.status === 'cancelled') return { status: 410, body: 'the order was cancelled' };
  return { status: 200, body: order };
}
