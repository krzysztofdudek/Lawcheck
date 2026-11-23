import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as numbers from '../numbers.ts';
import { ROOT } from '../harness/sets.ts';

const numeric = (value: unknown): boolean => typeof value === 'number' || (typeof value === 'object' && value !== null && Object.keys(value).length > 0 && Object.values(value).every(numeric));

const written = (text: string, name: string): boolean =>
  text.includes(`test(${JSON.stringify(name).replace(/^"|"$/g, "'")}`) || text.includes(`test('${name}'`) || text.includes(`test('${name.replace(/'/g, "\\'")}'`) || text.includes(`test(${JSON.stringify(name)}`);

const templated = (text: string, name: string): boolean =>
  [...text.matchAll(/test\(`((?:[^`\\]|\\.)*)`/g)].some(([, body]) => {
    const parts = body!.split(/\$\{[^}]*\}/);
    return parts.length > 1 && new RegExp(`^${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`, 's').test(name);
  });

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
    assert.ok(written(text, name!) || templated(text, name!), key);
    for (const [system, measured] of Object.entries(budgets.measured)) {
      assert.ok(['linux', 'darwin', 'win32'].includes(system), `${key}: ${system}`);
      assert.ok(measured! >= budgets.fixed, `${key}: ${system} measured ${measured} below its fixed waits`);
      assert.ok(measured! > numbers.TEST_BUDGET_MS / 5, `${key}: ${system} takes a fifth of TEST_BUDGET_MS or less and needs no entry`);
    }
  }
});

const holds = (finding: string, key: string, system: numbers.System, ms: number, run: string): void => {
  const budget = numbers.slowBudget(key, system);
  assert.ok(budget !== null, `${finding}: ${key} took ${ms} ms on ${system} in ${run}, and SLOW_TESTS has no entry for it there`);
  assert.ok(budget >= ms, `${finding}: ${key} took ${ms} ms on ${system} in ${run}, past its budget there of ${budget} ms`);
};

test('R-73: test 26 has an entry in SLOW_TESTS for win32, whose budget holds the time it took there in round 1 of Nightly 43809304091', () => {
  holds('R-73', 'tests/acceptance/rules.test.ts > test 26: the runner stops writes, programs, workers and reads outside', 'win32', 25_351, 'Nightly 43809304091, round 1');
});

test('R-78: test 242 has an entry in SLOW_TESTS for win32, whose budget holds the time it took there in round 1 of Nightly 43838961244', () => {
  holds('R-78', 'tests/limits/reviews.test.ts > test 242: S3-8, a review whose .lawcheck/.local cannot be written fails before the first call', 'win32', 23_659, 'Nightly 43838961244, round 1');
});

test('R-95: test 406 has an entry in SLOW_TESTS for linux, whose budget holds the time it took in a Linux commit job', () => {
  holds('R-95', 'tests/acceptance/program-providers.test.ts > test 406: codex', 'linux', 9_000, 'a Linux commit job');
});

test('harness-6: R-115, a test with no entry in SLOW_TESTS has 90 seconds on Windows and 20 elsewhere, and an entry never gives less than that', () => {
  const testBudget = (numbers as Record<string, unknown>).testBudget as ((key: string, system: numbers.System) => number) | undefined;
  assert.equal(typeof testBudget, 'function', 'tests/numbers.ts exports testBudget');
  assert.equal(testBudget!('no such test', 'win32'), 90_000);
  assert.equal(testBudget!('no such test', 'linux'), 20_000);
  assert.equal(testBudget!('no such test', 'darwin'), 20_000);
  const small = Object.keys(numbers.SLOW_TESTS).find((key) => (numbers.slowBudget(key, 'win32') ?? Infinity) < 90_000);
  assert.ok(small !== undefined, 'SLOW_TESTS holds an entry whose win32 budget is under 90 seconds');
  assert.equal(testBudget!(small!, 'win32'), 90_000, small);
  const large = Object.keys(numbers.SLOW_TESTS).find((key) => (numbers.slowBudget(key, 'win32') ?? 0) > 90_000)!;
  assert.equal(testBudget!(large, 'win32'), numbers.slowBudget(large, 'win32'), large);
});
