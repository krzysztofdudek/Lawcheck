import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromCwd, locate, nearPart, Stop, touchesLaw } from '../../dist/setup.js';

test('a path typed from a directory below the root is made relative to the root, and one outside is usage', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-setup-')));
  try {
    mkdirSync(join(dir, 'src/core'), { recursive: true });
    assert.equal(fromCwd(dir, join(dir, 'src/core'), 'price.ts'), 'src/core/price.ts');
    assert.equal(fromCwd(dir, join(dir, 'src'), '..'), '.');
    assert.equal(fromCwd(dir, dir, 'src/'), 'src');
    for (const word of ['../x', '/etc/passwd']) {
      assert.throws(() => fromCwd(dir, dir, word), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'usage');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('locate stops with not-initialized without a law', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-setup-'));
  try {
    assert.throws(() => locate(dir), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'not-initialized');
    mkdirSync(join(dir, '.lawcheck'));
    writeFileSync(join(dir, '.lawcheck/law.yaml'), 'lawcheck: 0.1.0\n');
    assert.equal(locate(dir), realpathSync(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the law and the rule files are what a change of the law touches', () => {
  assert.ok(touchesLaw('.lawcheck/law.yaml'));
  assert.ok(touchesLaw('.lawcheck/rules/no-todo.mjs'));
  assert.ok(touchesLaw('.lawcheck/rules/lib/shared.mjs'));
  assert.ok(!touchesLaw('.lawcheck/config.yaml'));
  assert.ok(!touchesLaw('.lawcheck/verdicts'));
  assert.ok(!touchesLaw('src/.lawcheck/law.yaml'));
});

test('the nearest id within two edits', () => {
  assert.equal(nearPart('no-tod', ['no-todo', 'no-console']), " (did you mean 'no-todo'?)");
  assert.equal(nearPart('zzz', ['no-todo']), '');
});
