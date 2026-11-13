import { users } from '../services/users';

export async function searchUsers(req: { query: { q?: string; limit?: string } }) {
  if (!req.query.q) return { status: 400, body: 'q is required' };
  const limit = Math.min(Number(req.query.limit ?? '20'), 100);
  return { status: 200, body: await users.search(req.query.q, limit) };
}
