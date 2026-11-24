import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inTemp } from '../acceptance/helpers.ts';
import { ROOT } from '../harness/sets.ts';
import { count, findTest, readEntries, sabotage } from '../sabotage/run.ts';
import type { Entry, Tools } from '../sabotage/run.ts';

const LIST = join(ROOT, 'tests', 'sabotage', 'list.json');
const ENTRY = { id: 'one', promise: 'test 1', file: 'src/a.ts', find: 'v = 1', replace: 'v = 2', killedBy: 'test 7: a' };

test('test 1003: tests/sabotage/list.json reads as entries with every field, each finds its text once in its file and names a test that exists', () => {
  const entries = readEntries(readFileSync(LIST, 'utf8'));
  assert.ok(entries.length > 0);
  const problems: string[] = [];
  for (const entry of entries) {
    const text = readFileSync(join(ROOT, entry.file), 'utf8');
    if (count(text, entry.find) !== 1) problems.push(`${entry.id}: its find text occurs ${count(text, entry.find)} times in ${entry.file}, not once`);
    if (findTest(ROOT, entry.killedBy) === null) problems.push(`${entry.id}: no test is named '${entry.killedBy}'`);
  }
  assert.deepEqual(problems, []);
});

test('test 1003: the list is refused when it is no array, holds an empty field, uses an id twice or replaces a text with itself', () => {
  const refused = (value: unknown, message: RegExp) => assert.throws(() => readEntries(JSON.stringify(value)), message);
  refused({}, /not a JSON array/);
  refused([{ ...ENTRY, replace: '' }], /entry 1 has no replace/);
  refused([{ ...ENTRY, find: undefined }], /entry 1 has no find/);
  refused([ENTRY, { ...ENTRY, replace: 'v = 3' }], /used twice/);
  refused([{ ...ENTRY, replace: 'v = 1' }], /replaces its text with itself/);
  assert.equal(readEntries(JSON.stringify([ENTRY])).length, 1);
});

test('test 1003: after a break is undone the sabotage run builds the unbroken code again before it runs the baseline of the next entry', async () => {
  await inTemp(async (dir) => {
    const root = join(dir, 'repo');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const v = 1;\n');
    writeFileSync(join(root, 'tests', 'a.test.ts'), "import { test } from 'node:test';\ntest('test 7: a', () => {});\ntest('test 8: b', () => {});\n");
    let built = '';
    const builds: string[] = [];
    const tools: Tools = {
      copyWorkingTree: (from, to) => cpSync(from, to, { recursive: true }),
      linkShared: () => undefined,
      build: (at) => {
        built = readFileSync(join(at, 'src', 'a.ts'), 'utf8');
        builds.push(built.trim());
        return { ok: true, output: '' };
      },
      runTests: () => {
        const state = built === 'export const v = 1;\n' ? 'ok' : 'not ok';
        return { tap: `${state} 1 - test 7: a\n${state} 2 - test 8: b\n`, status: 0 };
      },
    };
    const entries: Entry[] = [ENTRY, { ...ENTRY, id: 'two', replace: 'v = 3', killedBy: 'test 8: b' }];
    const outcomes = sabotage(root, entries, () => undefined, tools);
    assert.deepEqual(outcomes.map((o) => `${o.entry.id} ${o.result}`), ['one killed', 'two killed']);
    assert.deepEqual(builds, ['export const v = 1;', 'export const v = 2;', 'export const v = 1;', 'export const v = 3;']);
  });
});
