import { users } from '../services/users';

export async function listUsers() {
  const all = await users.list();
  return { status: 200, body: all.map((user) => ({ id: user.id, name: user.name })) };
}
