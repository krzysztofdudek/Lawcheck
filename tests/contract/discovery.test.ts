import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { COMMIT_GROUPS, EMPTY_GROUPS, groupDirs, NIGHTLY_GROUPS, setFiles, TEST_FILE, testNamedFiles, TESTS, walk } from '../harness/sets.ts';

function outsideTheSets(found: string[]): string[] {
  const commit = new Set(setFiles('commit', groupDirs('commit', null)!));
  const nightly = new Set(setFiles('nightly', groupDirs('nightly', null)!));
  return found.filter((path) => Number(commit.has(path)) + Number(nightly.has(path)) !== 1);
}

test('question 95: every file of the checkout named like a test is in exactly one set of the runner', () => {
  const found = testNamedFiles();
  assert.deepEqual(outsideTheSets(found), []);
  assert.ok(found.includes('tests/contract/discovery.test.ts'));
});

test('question 95: a test file planted outside tests/, in a fixture folder, or with another extension is found and caught (control)', () => {
  const planted = ['src/a.test.ts', 'scripts/a.test.ts', 'tests/security/attacks/a.test.ts', 'tests/sample/a.test.ts', 'tests/agent/a.test.ts', 'tests/unit/a.spec.ts', 'tests/unit/a.test.mjs'];
  const root = mkdtempSync(join(tmpdir(), 'lawcheck-discovery-'));
  try {
    for (const path of [...planted, 'node_modules/x/a.test.ts', 'dist/a.test.js', 'src/a.ts']) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), '');
    }
    assert.deepEqual(testNamedFiles(root), [...planted].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.deepEqual(outsideTheSets(planted), planted);
});

test('question 95: each group of a set names directories that the set walks, and the nightly set only its own directories', () => {
  const nightlyDirs = new Set(Object.values(NIGHTLY_GROUPS).flat());
  for (const dirs of Object.values(COMMIT_GROUPS)) for (const dir of dirs) assert.match(dir, /^[a-z]+$/);
  for (const path of walk(TESTS, (name) => name.endsWith('.nightly.test.ts'))) assert.ok(nightlyDirs.has(path.split('/')[1]!), path);
});

test('question 95: a test file the runner would not find is caught', () => {
  const planted = ['tests/agent/x.test.ts', 'tests/unit/x.spec.ts', 'tests/unit/x.test.mjs', 'tests/unit/x.nightly.test.ts'];
  const commit = new Set(setFiles('commit', groupDirs('commit', null)!).concat(['tests/unit/x.test.ts']));
  for (const path of planted) assert.ok(TEST_FILE.test(path) && !commit.has(path), path);
  assert.ok(!TEST_FILE.test(join('tests', 'unit', 'helpers.ts')));
});

test('question 95: a group declared empty in tests/harness/sets.ts holds no test file, and every other group holds one', () => {
  for (const speed of ['commit', 'nightly'] as const) {
    const groups = speed === 'commit' ? COMMIT_GROUPS : NIGHTLY_GROUPS;
    for (const group of Object.keys(groups)) {
      const files = setFiles(speed, groupDirs(speed, group)!);
      assert.equal(files.length === 0, EMPTY_GROUPS[speed].includes(group), `${speed} ${group}: ${files.length} files`);
    }
    for (const group of EMPTY_GROUPS[speed]) assert.ok(group in groups, `${speed} ${group}`);
  }
});
