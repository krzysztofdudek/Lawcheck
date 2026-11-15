import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_SKIPS, type PlatformSkip } from '../harness/skips.ts';

const SYSTEMS = ['linux', 'darwin', 'win32'];

export function widened(entries: Pick<PlatformSkip, 'file' | 'test' | 'part' | 'platform'>[]): string[] {
  const where = new Map<string, Set<string>>();
  for (const e of entries) where.set(`${e.file} > ${e.test} > ${e.part}`, new Set([...(where.get(`${e.file} > ${e.test} > ${e.part}`) ?? []), e.platform]));
  return [...where].filter(([, platforms]) => SYSTEMS.every((s) => platforms.has(s))).map(([key]) => key);
}

test('question 91: no test, and no part of a harness invariant, is skipped on every system', () => {
  assert.deepEqual(widened(PLATFORM_SKIPS), []);
});

test('question 91: control, a skip listed for Linux, macOS and Windows is named, and one for two systems or for root is not', () => {
  const entry = (platform: PlatformSkip['platform'], part = 'the whole test') => ({ file: 'tests/unit/a.test.ts', test: 'test 1: a', part, platform });
  assert.deepEqual(widened([entry('win32'), entry('linux'), entry('darwin')]), ['tests/unit/a.test.ts > test 1: a > the whole test']);
  assert.deepEqual(widened([entry('win32'), entry('linux'), entry('root')]), []);
  assert.deepEqual(widened([entry('win32'), entry('linux'), entry('darwin', 'a part')]), []);
  assert.equal(widened([{ file: 'tests/harness', test: 'every run', part: 'no process of the run is left alive', platform: 'win32' }, { file: 'tests/harness', test: 'every run', part: 'no process of the run is left alive', platform: 'linux' }, { file: 'tests/harness', test: 'every run', part: 'no process of the run is left alive', platform: 'darwin' }]).length, 1);
});
