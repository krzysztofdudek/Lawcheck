import { carts } from '../services/carts';
import { orders } from '../services/orders';

export async function checkout(req: { params: { cartId: string } }) {
  const cart = await carts.get(req.params.cartId);
  const order = await orders.create({ items: cart.items });
  return { status: 201, body: order };
}
