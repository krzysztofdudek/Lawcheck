import { invoices } from '../services/invoices';

export async function payInvoice(req: { params: { id: string }; body: { amount: unknown } }) {
  if (typeof req.body.amount !== 'number') return { status: 400, body: 'amount must be a number' };
  if (req.body.amount > 10000) return { status: 403, body: 'payments above 10000 need approval' };
  return { status: 200, body: await invoices.pay(req.params.id, req.body.amount) };
}
