import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('R-15: the settings page gives the line that lets a release younger than a day through for Yarn 4 and for pnpm, and the install matrix writes both', () => {
  const settings = read('docs/config.md');
  const cell = read('tests/environments/matrix/install-cell.sh');
  for (const [manager, key] of [['Yarn 4', 'npmPreapprovedPackages'], ['pnpm', 'minimumReleaseAgeExclude']] as const) {
    assert.ok(settings.includes(`\n${key}: [lawcheck, "@chrisdudek/runes"]\n`), `${manager}: docs/config.md gives the line of ${key}`);
    assert.ok(cell.includes(key), `${manager}: the install matrix sets ${key}`);
  }
  assert.ok(read('docs/support.md').includes('`pnpm-workspace.yaml`'), 'docs/support.md says that pnpm installs the release before');
});
