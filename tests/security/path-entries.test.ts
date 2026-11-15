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

test('I-start-1: findProgram and the hooks find a program in a quoted absolute PATH entry on Windows, and none through a relative entry', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { findProgram } = await import('../../dist/programs.js');
  const hooks = await import('../../plugin/hooks/start.mjs');
  const windows = process.platform === 'win32';
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-path-')));
  try {
    const bin = join(dir, 'bin');
    const here = join(dir, 'here');
    mkdirSync(bin);
    mkdirSync(here);
    for (const folder of [bin, here]) {
      const program = join(folder, windows ? 'tool.cmd' : 'tool');
      writeFileSync(program, windows ? '@echo off\r\n' : '#!/bin/sh\n');
      chmodSync(program, 0o755);
    }
    const entry = windows ? `"${bin}"` : bin;
    const env = { PATH: ['.', '', entry].join(delimiter), ...(windows ? { PATHEXT: '.CMD' } : {}) };
    const previous = process.cwd();
    process.chdir(here);
    try {
      const expected = join(bin, windows ? 'tool.cmd' : 'tool');
      assert.equal(findProgram('tool', env), expected);
      assert.equal(hooks.findProgram('tool', env), expected);
    } finally {
      process.chdir(previous);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
