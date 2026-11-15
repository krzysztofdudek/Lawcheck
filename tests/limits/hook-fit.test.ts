import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fit } from '../../plugin/hooks/fit.mjs';

const HEADER = 'Lawcheck: after this edit, a.ts breaks the law of this repository. lawcheck check ./a.ts printed:';
const cutTo = (line: string) => `${line.slice(0, 1960)}... (${line.length - 1960} more characters)`;

test('S6-7: test 246: a hook text holds at most 9,000 UTF-16 code units, and a line over 2,000 is cut', () => {
  const long = 'x'.repeat(20_000);
  const next = `next: ${'y'.repeat(20_000)}`;
  const text: string = fit(HEADER, ['lawcheck: FAIL  1 error in 1 named file', '', `a.ts:1  error[r]  ${long}`, '', next]);
  assert.ok(text.length <= 9000, String(text.length));
  assert.deepEqual(text.split('\n'), [HEADER, '', 'lawcheck: FAIL  1 error in 1 named file', '', cutTo(`a.ts:1  error[r]  ${long}`), '', cutTo(next)]);
  const first: string = fit(HEADER, [long]);
  assert.deepEqual(first.split('\n'), [HEADER, '', cutTo(long)]);
});

test('S6-7: test 246: a cut that would split a character outside the first plane keeps the pair whole', () => {
  const wide = `x${'\u{1F600}'.repeat(1500)}`;
  const text: string = fit(HEADER, ['lawcheck: FAIL  1 error in 1 named file', wide, 'next: fix a.ts:1']);
  assert.ok(text.length <= 9000, String(text.length));
  assert.deepEqual(text.split('\n'), [HEADER, '', 'lawcheck: FAIL  1 error in 1 named file', `${wide.slice(0, 1959)}... (${wide.length - 1959} more characters)`, 'next: fix a.ts:1']);
});
