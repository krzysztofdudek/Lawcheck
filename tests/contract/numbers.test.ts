import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as numbers from '../numbers.ts';
import { ROOT } from '../harness/sets.ts';

const numeric = (value: unknown): boolean => typeof value === 'number' || (typeof value === 'object' && value !== null && Object.keys(value).length > 0 && Object.values(value).every(numeric));

const written = (text: string, name: string): boolean =>
  text.includes(`test(${JSON.stringify(name).replace(/^"|"$/g, "'")}`) || text.includes(`test('${name}'`) || text.includes(`test('${name.replace(/'/g, "\\'")}'`) || text.includes(`test(${JSON.stringify(name)}`);

// The names of the files and folders of tests/ and docs/, with and without their extension: where a loop reads the names of its cases from the disk.
const ON_DISK = new Set<string>();
function visit(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    ON_DISK.add(entry.name);
    ON_DISK.add(entry.name.replace(/\.[^.]+$/, ''));
    if (entry.isDirectory()) visit(join(dir, entry.name));
  }
}
visit(join(ROOT, 'tests'));
visit(join(ROOT, 'docs'));

// A text that stands for a ${...} of a test name is written in the file as a string, or names a file or folder that the loop reads from the disk.
function standsFor(text: string, value: string): boolean {
  const unquoted = (() => {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  })();
  const spellings = [value, value.replace(/\\/g, '\\\\'), ...(unquoted === null ? [] : [unquoted, unquoted.replace(/\\/g, '\\\\')])];
  return spellings.some((spelling) => ["'", '"', '`'].some((quote) => text.includes(`${quote}${spelling}${quote}`))) || ON_DISK.has(value);
}

const templated = (text: string, name: string): boolean =>
  [...text.matchAll(/test\(`((?:[^`\\]|\\.)*)`/g)].some(([, body]) => {
    const parts = body!.split(/\$\{[^}]*\}/);
    if (parts.length < 2) return false;
    const found = new RegExp(`^${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)')}$`, 's').exec(name);
    return found !== null && found.slice(1).every((value) => standsFor(text, value));
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

test('R-115: a test with no entry in SLOW_TESTS has 90 seconds on Windows and 20 elsewhere, and an entry never gives less than that', () => {
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

test('R-117: a key of SLOW_TESTS whose name a template builds needs each text in place of a ${...} to be written in the file or to name a file the loop reads, so a case or a provider that is gone leaves the key refused', () => {
  const guard = readFileSync(join(ROOT, 'tests/guard/guard.test.ts'), 'utf8');
  const secrets = readFileSync(join(ROOT, 'tests/security/secrets.test.ts'), 'utf8');
  assert.equal(templated(guard, 'question 95: the suite guard, case no-such-case'), false);
  assert.equal(templated(secrets, 'S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode nobody (I-secret-1)'), false);
  assert.equal(templated(secrets, 'S3-2: the key of nobody appears in no output, file, temporary file or request but its own header, for a reply that is pass (I-secret-1)'), false);
  assert.equal(templated(guard, 'question 95: the suite guard, case refused-platform-test-narrowed'), true);
  assert.equal(templated(secrets, 'S3-2: the key of anthropic appears in no output, file, temporary file or request but its own header, for a reply that is 429 then pass (I-secret-1)'), true);
  assert.equal(templated(readFileSync(join(ROOT, 'tests/security/key-forms.test.ts'), 'utf8'), 'S3-2: claude-code with the key "k\\"e\\\\y-1x" in its environment: the answer is read, and the key is replaced in its message (I-secret-1)'), true);
  const stale = Object.keys(numbers.SLOW_TESTS).filter((key) => {
    const [file, name] = key.split(' > ');
    const text = readFileSync(join(ROOT, file!), 'utf8');
    return !written(text, name!) && !templated(text, name!);
  });
  assert.deepEqual(stale, []);
});
