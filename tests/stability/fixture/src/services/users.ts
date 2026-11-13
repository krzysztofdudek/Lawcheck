import { db } from '../db';

export async function register(email: string) {
  if (!email.includes('@')) return { error: 'Invalid input' };
  return { user: await db.users.insert({ email }) };
}
