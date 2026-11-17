import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as numbers from '../numbers.ts';
import { ROOT } from '../harness/sets.ts';

const numeric = (value: unknown): boolean => typeof value === 'number' || (typeof value === 'object' && value !== null && Object.keys(value).length > 0 && Object.values(value).every(numeric));

test('question 95: every number of tests/numbers.ts says which way is stronger, and nothing else does', () => {
  const exported = Object.entries(numbers)
    .filter(([, value]) => numeric(value))
    .map(([name]) => name)
    .filter((name) => name !== 'stronger')
    .sort();
  assert.deepEqual(Object.keys(numbers.stronger).sort(), exported);
});

test('question 95: every key of SLOW_TESTS names a test that exists, and every system listed there passes a fifth of TEST_BUDGET_MS', () => {
  for (const [key, budgets] of Object.entries(numbers.SLOW_TESTS)) {
    const [file, name] = key.split(' > ');
    const text = readFileSync(join(ROOT, file!), 'utf8');
    assert.ok(text.includes(`test(${JSON.stringify(name).replace(/^"|"$/g, "'")}`) || text.includes(`test('${name}'`) || text.includes(`test('${name!.replace(/'/g, "\\'")}'`), key);
    for (const [system, measured] of Object.entries(budgets.measured)) {
      assert.ok(['linux', 'darwin', 'win32'].includes(system), `${key}: ${system}`);
      assert.ok(measured! >= budgets.fixed, `${key}: ${system} measured ${measured} below its fixed waits`);
      assert.ok(measured! > numbers.TEST_BUDGET_MS / 5, `${key}: ${system} takes a fifth of TEST_BUDGET_MS or less and needs no entry`);
    }
  }
});
