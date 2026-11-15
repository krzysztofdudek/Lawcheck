import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as numbers from '../numbers.ts';
import { ROOT } from '../harness/sets.ts';

test('every number of tests/numbers.ts says which way is stronger, and nothing else does', () => {
  const exported = Object.entries(numbers)
    .filter(([, value]) => typeof value === 'number' || (typeof value === 'object' && value !== null && Object.values(value).every((v) => typeof v === 'number' || (typeof v === 'object' && v !== null && Object.values(v).every((w) => typeof w === 'number')))))
    .map(([name]) => name)
    .filter((name) => name !== 'stronger')
    .sort();
  assert.deepEqual(Object.keys(numbers.stronger).sort(), exported);
});

test('every key of SLOW_TESTS names a test that exists, and every budget there is above TEST_BUDGET_MS', () => {
  for (const [key, budgets] of Object.entries(numbers.SLOW_TESTS)) {
    const [file, name] = key.split(' > ');
    const text = readFileSync(join(ROOT, file!), 'utf8');
    assert.ok(text.includes(`test(${JSON.stringify(name).replace(/^"|"$/g, "'")}`) || text.includes(`test('${name}'`), key);
    for (const [system, budget] of Object.entries(budgets)) {
      assert.ok(['linux', 'darwin', 'win32'].includes(system), `${key}: ${system}`);
      assert.ok(budget! > numbers.TEST_BUDGET_MS, `${key}: ${system} ${budget}`);
    }
  }
});
