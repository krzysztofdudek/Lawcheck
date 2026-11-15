import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { COMMIT_GROUPS, EMPTY_GROUPS, groupDirs, NIGHTLY_GROUPS, setFiles, TEST_FILE, TESTS, walk } from '../harness/sets.ts';

test('every test file under tests/ is in exactly one set of the runner', () => {
  const found = walk(TESTS, (name) => TEST_FILE.test(name));
  const commit = new Set(setFiles('commit', groupDirs('commit', null)!));
  const nightly = new Set(setFiles('nightly', groupDirs('nightly', null)!));
  const wrong = found.filter((path) => Number(commit.has(path)) + Number(nightly.has(path)) !== 1);
  assert.deepEqual(wrong, []);
  assert.ok(found.length > 0);
});

test('each group of a set names directories that the set walks, and the nightly set only its own directories', () => {
  const nightlyDirs = new Set(Object.values(NIGHTLY_GROUPS).flat());
  for (const dirs of Object.values(COMMIT_GROUPS)) for (const dir of dirs) assert.match(dir, /^[a-z]+$/);
  for (const path of walk(TESTS, (name) => name.endsWith('.nightly.test.ts'))) assert.ok(nightlyDirs.has(path.split('/')[1]!), path);
});

test('a test file the runner would not find is caught', () => {
  const planted = ['tests/agent/x.test.ts', 'tests/unit/x.spec.ts', 'tests/unit/x.test.mjs', 'tests/unit/x.nightly.test.ts'];
  const commit = new Set(setFiles('commit', groupDirs('commit', null)!).concat(['tests/unit/x.test.ts']));
  for (const path of planted) assert.ok(TEST_FILE.test(path) && !commit.has(path), path);
  assert.ok(!TEST_FILE.test(join('tests', 'unit', 'helpers.ts')));
});

test('a group declared empty in tests/harness/sets.ts holds no test file, and every other group holds one', () => {
  for (const speed of ['commit', 'nightly'] as const) {
    const groups = speed === 'commit' ? COMMIT_GROUPS : NIGHTLY_GROUPS;
    for (const group of Object.keys(groups)) {
      const files = setFiles(speed, groupDirs(speed, group)!);
      assert.equal(files.length === 0, EMPTY_GROUPS[speed].includes(group), `${speed} ${group}: ${files.length} files`);
    }
    for (const group of EMPTY_GROUPS[speed]) assert.ok(group in groups, `${speed} ${group}`);
  }
});
