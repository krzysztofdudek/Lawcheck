import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, findRoot } from '../../dist/check.js';

test('the root is the nearest directory above that holds .lawcheck/law.yaml, as its real path', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-root-')));
  try {
    mkdirSync(join(dir, 'outer/.lawcheck'), { recursive: true });
    mkdirSync(join(dir, 'outer/inner/.lawcheck'), { recursive: true });
    mkdirSync(join(dir, 'outer/inner/deep/er'), { recursive: true });
    mkdirSync(join(dir, 'outer/plain/.lawcheck/law.yaml'), { recursive: true });
    writeFileSync(join(dir, 'outer/.lawcheck/law.yaml'), 'lawcheck: 0.1.0\n');
    writeFileSync(join(dir, 'outer/inner/.lawcheck/law.yaml'), 'lawcheck: 0.1.0\n');
    symlinkSync(join(dir, 'outer/inner'), join(dir, 'link'));
    assert.equal(findRoot(join(dir, 'outer/inner/deep/er')), join(dir, 'outer/inner'));
    assert.equal(findRoot(join(dir, 'outer/plain')), join(dir, 'outer'));
    assert.equal(findRoot(join(dir, 'link')), join(dir, 'outer/inner'));
    assert.equal(findRoot(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no law here or above is not-initialized', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-none-'));
  try {
    const outcome = await check({ full: false, base: null }, { cwd: dir, env: {} });
    assert.ok('errors' in outcome);
    assert.equal(outcome.errors[0]!.code, 'not-initialized');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
