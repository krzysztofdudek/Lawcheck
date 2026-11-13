import { usageError } from './args.js';
import type { Arguments, Result } from './args.js';
import type { CheckContext } from './check.js';

export async function doctor(_args: Arguments, _context: CheckContext, json: boolean): Promise<Result> {
  return usageError('doctor is not built yet', json, 'doctor');
}
