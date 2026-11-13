import { db } from '../db';

export async function deleteUser(req: { params: { id: string } }) {
  await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  return { status: 204, body: null };
}
