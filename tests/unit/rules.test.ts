import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage, validate } from '../../dist/rules.js';

const FILE = { path: 'src/a.ts', type: { id: 'source' }, rules: [], text: 'a\nb\n', lines: ['a', 'b'] } as never;

test('check-slice §3: a valid answer becomes findings with the call path', () => {
  const result = validate('r', [{ message: 'x' }, { message: 'y\r\nz', line: 2, file: 'src/a.ts', column: 4 }], FILE);
  assert.deepEqual(result, {
    findings: [
      { rule: 'r', file: 'src/a.ts', message: 'x' },
      { rule: 'r', file: 'src/a.ts', message: 'y z', line: 2 },
    ],
  });
});

test('S2-4: a line that is null is a finding about the whole file, with no line', () => {
  assert.deepEqual(validate('r', [{ message: 'x', line: null }], FILE), { findings: [{ rule: 'r', file: 'src/a.ts', message: 'x' }] });
  const empty = { path: 'src/a.ts', type: { id: 'source' }, rules: [], text: '', lines: [] } as never;
  assert.deepEqual(validate('r', [{ message: 'x', line: null }], empty), { findings: [{ rule: 'r', file: 'src/a.ts', message: 'x' }] });
});

test('check-slice §3: every broken answer is named', () => {
  const broken = [{}, null, 'x', [null], [[]], [{ line: 1 }], [{ message: '' }], [{ message: 'x', file: 'b.ts' }], [{ message: 'x', line: 0 }], [{ message: 'x', line: 3 }], [{ message: 'x', line: 1.5 }], [{ message: 'x', line: NaN }], [{ message: 'x', line: '1' }]];
  for (const value of broken) assert.ok('problem' in validate('r', value, FILE), JSON.stringify(value));
});

test('check-slice §3: each line break in a message becomes one space', () => {
  assert.equal(normalizeMessage('a\nb\r\nc\rd'), 'a b c d');
});
