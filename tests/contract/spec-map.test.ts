import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invariantsOf, loadInputs, problemsOf, rowsOf, sourcesOf, testNames, type Inputs } from './spec-map.ts';

const REPO = new URL('../../', import.meta.url);

const table = (head: string, rows: string[]) => ['# A spec', '', `| ${head} |`, '|---|---|---|', ...rows, ''].join('\n');

function inputs(over: Partial<Inputs> = {}): Inputs {
  return {
    specs: [{ stem: 'one-slice', text: ['## 1. Scope', '', table('# | Do | See', ['| 1 | a | b |', '| 2 | c | d |']), table('Id | Promise | Test', ['| I-out-1 | p | tests/x.test.ts |'])].join('\n') }],
    questions: '## 5. A question\n',
    tests: [
      { file: 'tests/a.test.ts', name: 'test 1: a' },
      { file: 'tests/a.test.ts', name: 'tests 2 and 1: c' },
      { file: 'tests/a.test.ts', name: 'I-out-1: no forged line' },
      { file: 'tests/a.test.ts', name: 'S1-1: a hang' },
      { file: 'tests/a.test.ts', name: 'one-slice §1: scope' },
      { file: 'tests/a.test.ts', name: 'question 5: a ruling' },
    ],
    manual: table('# | Why | Who', []),
    ledger: '| S1-1 | blocks | x |\n',
    ...over,
  };
}

test('question 79: every row of every acceptance table has a test, every test a source, and no number is used twice', () => {
  assert.deepEqual(problemsOf(loadInputs(REPO)), []);
});

test('question 79 control: the rail passes a consistent small map', () => {
  assert.deepEqual(problemsOf(inputs()), []);
});

test('question 79 control: a row without a test, a test number without a row, and a number used twice are named', () => {
  const noTest = problemsOf(inputs({ tests: inputs().tests.filter((t) => !t.name.includes('1')) }));
  assert.ok(noTest.some((p) => p === 'row 1 of one-slice has no test'), noTest.join('\n'));
  const stray = problemsOf(inputs({ tests: [...inputs().tests, { file: 'tests/a.test.ts', name: 'test 9: nothing' }] }));
  assert.ok(stray.some((p) => p.includes('names test 9, which is in no spec table')), stray.join('\n'));
  const twice = problemsOf(inputs({ specs: [...inputs().specs, { stem: 'two-slice', text: table('# | Do | See', ['| 2 | e | f |']) }] }));
  assert.ok(twice.some((p) => p === 'row 2 is used twice (again in two-slice)'), twice.join('\n'));
});

test('question 79 control: a test with no source, an unknown finding, section or question, and an invariant without a test are named', () => {
  const none = problemsOf(inputs({ tests: [...inputs().tests, { file: 'tests/a.test.ts', name: 'something that works' }] }));
  assert.ok(none.some((p) => p.includes('names no source')), none.join('\n'));
  const names = [
    ...inputs().tests,
    { file: 'tests/a.test.ts', name: 'S9-9: not in the ledger' },
    { file: 'tests/a.test.ts', name: 'one-slice §7: no such heading' },
    { file: 'tests/a.test.ts', name: 'question 6: no such entry' },
    { file: 'tests/a.test.ts', name: 'I-out-2: no such invariant' },
  ];
  const unknown = problemsOf(inputs({ tests: names }));
  for (const part of ['finding S9-9', 'one-slice §7', 'question 6', 'invariant I-out-2']) assert.ok(unknown.some((p) => p.includes(part)), part);
  const lone = problemsOf(inputs({ tests: inputs().tests.filter((t) => !t.name.startsWith('I-out-1')) }));
  assert.ok(lone.some((p) => p.includes('invariant I-out-1 of one-slice has no test')), lone.join('\n'));
});

test('question 79 control: a row listed as run by hand needs a spec row and no test', () => {
  const listed = problemsOf(inputs({ manual: table('# | Why | Who', ['| 2 | by hand | the reviewer |']), tests: inputs().tests.filter((t) => !t.name.startsWith('tests 2')) }));
  assert.deepEqual(listed, []);
  const stale = problemsOf(inputs({ manual: table('# | Why | Who', ['| 1 | by hand | the reviewer |']) }));
  assert.ok(stale.some((p) => p.includes('carries row 1')), stale.join('\n'));
  const stray = problemsOf(inputs({ manual: table('# | Why | Who', ['| 8 | by hand | the reviewer |']) }));
  assert.ok(stray.some((p) => p.includes('row 8 is listed') && p.includes('no spec table')), stray.join('\n'));
});

test('question 79: the parsers read tables, invariants and test names', () => {
  assert.deepEqual(rowsOf({ stem: 's', text: table('# | Setup and action | Expected', ['| 7 | x | y |', '| 8 | x | y |']) }).map((r) => r.number), [7, 8]);
  assert.deepEqual(invariantsOf({ stem: 's', text: table('Id | Promise | Test', ['| I-frame-1 | p | f.ts |', '| `I-out-2` | p | f.ts |']) }).map((i) => i.id), ['I-frame-1', 'I-out-2']);
  const call = 'te' + 'st(';
  const text = [`${call}'it\\'s test 4', () => {});`, `${call}\n  "two",\n);`, `await t.${call}'sub', async () => {});`, `const r = /x/.${call}'abc');`].join('\n');
  const names = testNames('f.ts', text);
  assert.deepEqual(names.map((n) => n.name), ["it's test 4", 'two', 'sub']);
  assert.deepEqual(sourcesOf('tests 3, 4 and 5 and I-a-1, S2-3, check-slice §3.5, question 7'), { rows: [3, 4, 5], invariants: ['I-a-1'], findings: ['S2-3'], sections: [['check-slice', '3.5']], questions: [7] });
});
