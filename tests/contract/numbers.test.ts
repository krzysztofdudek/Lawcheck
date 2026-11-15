import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as numbers from '../numbers.ts';

test('every number of tests/numbers.ts says which way is stronger, and nothing else does', () => {
  const exported = Object.entries(numbers)
    .filter(([, value]) => typeof value === 'number' || (typeof value === 'object' && value !== null && Object.values(value).every((v) => typeof v === 'number')))
    .map(([name]) => name)
    .filter((name) => name !== 'stronger')
    .sort();
  assert.deepEqual(Object.keys(numbers.stronger).sort(), exported);
});
