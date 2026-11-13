import { db } from '../db';

export async function resume(token: string) {
  const session = await db.sessions.find(token);
  if (session === undefined) throw new Error('The session has expired. Sign in again to continue.');
  return session;
}
