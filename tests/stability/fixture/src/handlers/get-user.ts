import { users } from '../services/users';

export async function getUser(req: { params: { id?: string } }) {
  const id = req.params.id;
  if (!id) return { status: 400, body: 'id is required' };
  return { status: 200, body: await users.find(id) };
}
