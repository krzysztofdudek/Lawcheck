import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delimiter } from 'node:path';
import { absolutePath } from '../../dist/programs.js';

// cmd.exe accepts a PATH entry wrapped in double quotes; the filter must keep a quoted absolute entry and still drop a relative one.
test('I-start-1: the PATH filter keeps a quoted absolute entry and drops a relative or empty one', () => {
  for (const platform of ['linux', 'win32'] as const) {
    const sep = platform === 'win32' ? ';' : ':';
    const absolute = platform === 'win32' ? 'C:\\Tools\\bin' : '/usr/bin';
    const quoted = `"${absolute}"`;
    const env: Record<string, string> = { PATH: [quoted, absolute, '.', '', 'node_modules/.bin'].join(sep) };
    absolutePath(env, platform);
    const kept = env.PATH!.split(sep).filter((entry) => entry !== '');
    // cmd.exe reads a double-quoted entry; only Windows keeps it.
    assert.deepEqual(kept, platform === 'win32' ? [quoted, absolute] : [absolute], `${platform}: ${env.PATH}`);
  }
});
