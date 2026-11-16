import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_SKIPS, type PlatformSkip } from '../harness/skips.ts';

const SYSTEMS = ['linux', 'darwin', 'win32'];

// A test is skipped on every system when its entries, of whatever parts, name Linux, macOS and Windows together.
export function widened(entries: Pick<PlatformSkip, 'file' | 'test' | 'part' | 'platform'>[]): string[] {
  const where = new Map<string, Set<string>>();
  for (const e of entries) where.set(`${e.file} > ${e.test}`, new Set([...(where.get(`${e.file} > ${e.test}`) ?? []), e.platform]));
  return [...where].filter(([, platforms]) => SYSTEMS.every((s) => platforms.has(s))).map(([key]) => key);
}

test('R-50: no test, and no part of a harness invariant, is skipped on every system', () => {
  assert.deepEqual(widened(PLATFORM_SKIPS), []);
});

test('R-50: control, a skip listed for Linux, macOS and Windows is named, in one part or in three, and one for two systems or for root is not', () => {
  const entry = (platform: PlatformSkip['platform'], part = 'the whole test') => ({ file: 'tests/unit/a.test.ts', test: 'test 1: a', part, platform });
  assert.deepEqual(widened([entry('win32'), entry('linux'), entry('darwin')]), ['tests/unit/a.test.ts > test 1: a']);
  assert.deepEqual(widened([entry('win32', 'a part'), entry('linux', 'another part'), entry('darwin', 'a third part')]), ['tests/unit/a.test.ts > test 1: a']);
  assert.deepEqual(widened([entry('win32'), entry('linux'), entry('root')]), []);
  assert.equal(widened(['win32', 'linux', 'darwin'].map((platform) => ({ file: 'tests/harness', test: 'every run', part: `part of ${platform}`, platform: platform as PlatformSkip['platform'] }))).length, 1);
});
