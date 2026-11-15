import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as numbers from '../numbers.ts';
import { ROOT } from '../harness/sets.ts';

const numeric = (value: unknown): boolean => typeof value === 'number' || (typeof value === 'object' && value !== null && Object.keys(value).length > 0 && Object.values(value).every(numeric));

test('every number of tests/numbers.ts says which way is stronger, and nothing else does', () => {
  const exported = Object.entries(numbers)
    .filter(([, value]) => numeric(value))
    .map(([name]) => name)
    .filter((name) => name !== 'stronger')
    .sort();
  assert.deepEqual(Object.keys(numbers.stronger).sort(), exported);
});

test('every key of SLOW_TESTS names a test that exists, and every system listed there needs more than TEST_BUDGET_MS', () => {
  for (const [key, budgets] of Object.entries(numbers.SLOW_TESTS)) {
    const [file, name] = key.split(' > ');
    const text = readFileSync(join(ROOT, file!), 'utf8');
    assert.ok(text.includes(`test(${JSON.stringify(name).replace(/^"|"$/g, "'")}`) || text.includes(`test('${name}'`), key);
    for (const [system, measured] of Object.entries(budgets.measured)) {
      assert.ok(['linux', 'darwin', 'win32'].includes(system), `${key}: ${system}`);
      assert.ok(measured! >= budgets.fixed, `${key}: ${system} measured ${measured} below its fixed waits`);
      assert.ok(budgets.fixed + numbers.SLOW_MARGIN * (measured! - budgets.fixed) > numbers.TEST_BUDGET_MS, `${key}: ${system} fits in TEST_BUDGET_MS and needs no entry`);
    }
  }
});
