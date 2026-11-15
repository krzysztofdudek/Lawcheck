import { test } from 'node:test';
import { exampleText } from '../harness/examples.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GITIGNORE, lawText, writeNew } from '../../dist/init.js';
import { parseLaw } from '../../dist/law.js';

test('the law init writes reads as a law with no types and no rules', () => {
  const { law, problems } = parseLaw(lawText('0.1.0'));
  assert.deepEqual(problems, []);
  assert.equal(law!.types.length, 0);
  assert.equal(law!.rules.size, 0);
});

test('the version line takes MAJOR.MINOR.PATCH of the package version', () => {
  assert.equal(lawText('1.2.3-beta.4').split('\n')[0], 'lawcheck: 1.2.3');
  assert.equal(lawText('0.1.0').split('\n')[0], 'lawcheck: 0.1.0');
});

test('the .gitignore keeps the local folder and the local settings out of git', () => {
  assert.equal(GITIGNORE, exampleText('init-gitignore'));
});

test('a file that exists is never written over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-init-'));
  try {
    const path = join(dir, 'law.yaml');
    writeFileSync(path, 'kept\n');
    assert.equal(writeNew(path, 'new\n'), false);
    assert.equal(readFileSync(path, 'utf8'), 'kept\n');
    assert.equal(writeNew(join(dir, 'fresh.yaml'), 'new\n'), true);
    assert.equal(readFileSync(join(dir, 'fresh.yaml'), 'utf8'), 'new\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
