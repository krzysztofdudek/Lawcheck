import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GITIGNORE, lawText } from '../../dist/init.js';
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
  assert.equal(GITIGNORE, '.local/\nconfig.local.yaml\n');
});
