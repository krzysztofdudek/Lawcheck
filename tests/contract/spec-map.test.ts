import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invariantsOf, ledgerProblems, loadInputs, problemsOf, rowsOf, scanTests, sourcesOf, type Inputs } from './spec-map.ts';
import { SECTION_ONLY_TESTS } from './ratchets.ts';

const REPO = new URL('../../', import.meta.url);

const table = (head: string, rows: string[]) => ['', `| ${head} |`, '|---|---|---|', ...rows, ''].join('\n');
const code = (...lines: string[]) => [`import { test } from 'node:test';`, ...lines, ''].join('\n');

const LEDGER = [
  '| id | severity | class | defect and reproduction | layer | package | Runes cause | test | generalised by | state |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| S1-1 | should be fixed before | limit | a hang | 2, 4 | D | no |  |  | open |',
  '| S1-2 | after the release | wording | a word | - | after alpha | no |  |  | question 5 |',
].join('\n');

function inputs(over: Partial<Inputs> = {}): Inputs {
  return {
    specs: [{ path: 'spec/one-slice.md', text: ['## 1. Scope', '', table('# | Do | See', ['| 1 | a | b |', '| 2 | c | d |']), table('Id | Promise | Test', ['| I-out-1 | p | tests/x.test.ts |'])].join('\n') }],
    docs: [],
    questions: '## 5. A question\n',
    tests: [
      {
        path: 'tests/unit/a.test.ts',
        text: code(
          `test('test 1: a', () => {});`,
          `test('tests 2 and 1: c', () => {});`,
          `test('I-out-1: no forged line', () => {});`,
          `test('S1-1: a hang', () => {});`,
          `test('one-slice §1: scope', () => {});`,
          `test('question 5: a ruling', () => {});`,
        ),
      },
    ],
    manual: table('# | Why no test carries it | Who runs it', []),
    ledger: LEDGER,
    sectionOnly: 2,
    ...over,
  };
}

const withTests = (...lines: string[]): Partial<Inputs> => ({ tests: [{ path: 'tests/unit/a.test.ts', text: code(...lines) }] });
const all = ["test('test 1: a', () => {});", "test('tests 2: c', () => {});", "test('I-out-1: i', () => {});"];

test('question 79: every row of every acceptance table has a test, every test a source that leads its name, and no number is used twice', () => {
  assert.deepEqual(problemsOf(loadInputs(REPO, SECTION_ONLY_TESTS)), []);
});

test('question 79 control: a consistent small map has no problem', () => {
  assert.deepEqual(problemsOf(inputs()), []);
});

test('question 79 control: a row without a test, a test number without a row, and a number used twice are named', () => {
  const noTest = problemsOf(inputs(withTests("test('test 1: a', () => {});", "test('I-out-1: i', () => {});")));
  assert.ok(noTest.includes('row 2 of spec/one-slice.md has no test'), noTest.join('\n'));
  const stray = problemsOf(inputs(withTests(...all, "test('test 9: nothing', () => {});")));
  assert.ok(stray.some((p) => p.includes('names test 9, which is in no spec table')), stray.join('\n'));
  const twice = problemsOf(inputs({ specs: [...inputs().specs, { path: 'spec/two-slice.md', text: table('# | Do | See', ['| 2 | e | f |']) }] }));
  assert.ok(twice.includes('row 2 is used twice (again in spec/two-slice.md)'), twice.join('\n'));
});

test('question 79 control: a test that does not run covers nothing', () => {
  const skipped = [
    "test.skip('test 2: skipped', () => {});",
    "test('test 2: skipped by option', { skip: true }, () => {});",
    "test('test 2: todo by option', { todo: 'later' }, () => {});",
    "test.todo('test 2: todo');",
    "// test('test 2: commented out', () => {});",
    "/* test('test 2: in a block comment', () => {}); */",
    "const s = \"test('test 2: in a string', () => {})\";",
    'const t = `test(\'test 2: in a template\', () => {})`;',
  ];
  for (const line of skipped) {
    const problems = problemsOf(inputs({ ...withTests("test('test 1: a', () => {});", "test('I-out-1: i', () => {});", line), sectionOnly: 0 }));
    assert.ok(problems.includes('row 2 of spec/one-slice.md has no test'), `${line}\n${problems.join('\n')}`);
  }
  const live = problemsOf(inputs({ ...withTests("test('test 1: a', () => {});", "test('I-out-1: i', () => {});", "test('test 2: runs', { skip: false }, () => {});"), sectionOnly: 0 }));
  assert.deepEqual(live, []);
});

test('question 79 control: a test call the rail cannot read, and a test in a place the runner does not run, are named', () => {
  const unreadable: [string, string][] = [
    ["test({ name: 'test 2: x' }, () => {});", 'is not a literal string'],
    ["const name = 'test 2: x'; test(name, () => {});", 'is not a literal string'],
    ['test(`test 2: ${1}`, () => {});', 'is not a literal string'],
    ["suite('test 2: x', () => {});", 'suite() is not read'],
    ["test.only('test 2: x', () => {});", '.only is not allowed'],
    ['const check = test;', 'assigned to another name'],
  ];
  for (const [line, part] of unreadable) {
    const problems = problemsOf(inputs(withTests(...all, line)));
    assert.ok(problems.some((p) => p.includes(part)), `${line}\n${problems.join('\n')}`);
  }
  for (const head of ["import { test as it2 } from 'node:test';", "import * as nt from 'node:test';", "import { suite } from 'node:test';", "import check from 'node:test';"]) {
    const scanned = scanTests('tests/unit/a.test.ts', [head, "it2('test 1: a', () => {});"].join('\n'));
    assert.ok(scanned.problems.length > 0, head);
  }
  assert.ok(scanTests('tests/unit/a.test.ts', "test('test 1: a', () => {});").problems.some((p) => p.includes('imports nothing from node:test')));
  assert.deepEqual(scanTests('tests/unit/a.test.ts', code("import { describe, it } from 'node:test';", "describe('S1-1: group', () => { it('S1-1: inner', async (t) => { await t.test('S1-1: sub', () => {}); }); });")).tests.map((t) => t.name), ['S1-1: inner', 'S1-1: sub']);
});

test('question 79 control: a name leads with its source, and every source it cites exists', () => {
  const junk = problemsOf(inputs(withTests(...all, "test('test 1 and test 9999: a', () => {});", "test('a hang, S1-1', () => {});", "test('S1-1: a hang and S9-9', () => {});", "test('test 1: and one-slice §9', () => {});", "test('test 1: and question 6', () => {});", "test('test 1: and I-out-2', () => {});")));
  for (const part of ['test 9999', 'a hang, S1-1" does not lead with its source', 'finding S9-9', 'one-slice §9', 'question 6', 'invariant I-out-2']) assert.ok(junk.some((p) => p.includes(part)), `${part}\n${junk.join('\n')}`);
  const none = problemsOf(inputs(withTests(...all, "test('something that works', () => {});")));
  assert.ok(none.some((p) => p.includes('names no source')), none.join('\n'));
  const lone = problemsOf(inputs(withTests("test('test 1: a', () => {});", "test('tests 2: c', () => {});")));
  assert.ok(lone.some((p) => p.includes('invariant I-out-1 of spec/one-slice.md has no test')), lone.join('\n'));
});

test('question 79 control: the tables are read strictly, and code fences hide nothing and add nothing', () => {
  const read = (text: string) => rowsOf({ path: 'spec/x.md', text });
  assert.ok(read(table('# | Do | See', ['| 1 | a | b |', '| 2a | c | d |'])).problems.some((p) => p.includes('"2a"')));
  assert.ok(read(table('# | Do | See', ['| 1 | a | b |', '| `2` | c | d |'])).problems.length > 0);
  assert.ok(read(table('No | Do | See', ['| 1 | a | b |', '| 2 | c | d |'])).problems.some((p) => p.includes('looks like an acceptance table')));
  assert.deepEqual(read(['```', '| # | Do | See |', '|---|---|---|', '| 7 | a | b |', '```'].join('\n')), { rows: [], problems: [] });
  const bad = invariantsOf({ path: 'spec/x.md', text: table('Id | Promise | Test', ['| I-frame-1 | p | f.ts |', '| I-Frame-2 | p | f.ts |', '| I-3 | p | f.ts |']) });
  assert.deepEqual(bad.invariants.map((i) => i.id), ['I-frame-1']);
  assert.equal(bad.problems.length, 2);
  const inDocs = problemsOf(inputs({ docs: [{ path: 'docs/a.md', text: table('Id | Promise | Test', ['| I-doc-1 | p | f.ts |']) }] }));
  assert.ok(inDocs.includes('invariant I-doc-1 of docs/a.md has no test with its id in the name'), inDocs.join('\n'));
  const fenced = problemsOf(inputs({ specs: [{ path: 'spec/one-slice.md', text: [inputs().specs[0]!.text, '```', '## 7. Hidden', '```'].join('\n') }], ...withTests(...all, "test('one-slice §7: hidden', () => {});") }));
  assert.ok(fenced.some((p) => p.includes('one-slice §7')), fenced.join('\n'));
});

test('question 79 control: a row run by hand needs a spec row, a reason, an owner, and no test', () => {
  const ok = problemsOf(inputs({ manual: table('# | Why no test carries it | Who runs it', ['| 2 | by hand on the host | the reviewer |']), ...withTests("test('test 1: a', () => {});", "test('I-out-1: i', () => {});"), sectionOnly: 0 }));
  assert.deepEqual(ok, []);
  const stale = problemsOf(inputs({ manual: table('# | Why no test carries it | Who runs it', ['| 1 | by hand on the host | the reviewer |']) }));
  assert.ok(stale.some((p) => p.includes('carries row 1')), stale.join('\n'));
  const stray = problemsOf(inputs({ manual: table('# | Why no test carries it | Who runs it', ['| 8 | by hand on the host | the reviewer |']) }));
  assert.ok(stray.some((p) => p.includes('row 8 is listed') && p.includes('no spec table')), stray.join('\n'));
  const bare = problemsOf(inputs({ manual: table('# | Why no test carries it | Who runs it', ['| 2 |  |  |']), ...withTests("test('test 1: a', () => {});", "test('I-out-1: i', () => {});") }));
  assert.ok(bare.some((p) => p.includes('without a reason')) && bare.some((p) => p.includes('without an owner')), bare.join('\n'));
});

test('question 79 control: the count of tests that cite only a section may only fall', () => {
  assert.ok(problemsOf(inputs({ sectionOnly: 1 })).some((p) => p.includes('the ratchet allows 1')));
  assert.ok(problemsOf(inputs({ sectionOnly: 3 })).some((p) => p.includes('lower SECTION_ONLY_TESTS')));
});

test('question 79 control: the ledger has unique well-formed ids and fixed sets, a closed row names a real test, and a question row points to its entry', () => {
  const run = (rows: string[], tests: { file: string; name: string }[] = []) => ledgerProblems([LEDGER.split('\n').slice(0, 2).join('\n'), ...rows].join('\n'), tests, new Set([5]));
  const row = (id: string, sev: string, layer: string, pkg: string, runes: string, test: string, state: string) => `| ${id} | ${sev} | c | a defect | ${layer} | ${pkg} | ${runes} | ${test} |  | ${state} |`;
  const good = row('S1-1', 'after the release', '2', 'D', 'no', '', 'open');
  assert.deepEqual(run([good]), []);
  assert.ok(run([good, good]).some((p) => p.includes('used twice')));
  assert.ok(run([row('X1-1', 'after the release', '2', 'D', 'no', '', 'open')]).some((p) => p.includes('the id is not')));
  assert.ok(run([row('S1-1', 'soon', '2', 'D', 'no', '', 'open')]).some((p) => p.includes('severity')));
  assert.ok(run([row('S1-1', 'after the release', '12', 'D', 'no', '', 'open')]).some((p) => p.includes('layer')));
  assert.ok(run([row('S1-1', 'after the release', '2', 'Z', 'no', '', 'open')]).some((p) => p.includes('package')));
  assert.ok(run([row('S1-1', 'blocks the release', '2', 'after alpha', 'no', '', 'open')]).some((p) => p.includes('needs a package')));
  assert.ok(run([row('S1-1', 'after the release', '2', 'D', 'yes', '', 'open')]).some((p) => p.includes('a Runes cause')));
  assert.ok(run([row('S1-1', 'after the release', '2', 'D', 'no', '', 'finished')]).some((p) => p.includes('state "finished"')));
  assert.ok(run([row('S1-1', 'after the release', '2', 'D', 'no', '', 'question 6')]).some((p) => p.includes('question 6')));
  assert.deepEqual(run([row('S1-1', 'after the release', '2', 'D', 'no', '', 'question 5')]), []);
  assert.ok(run([row('S1-1', 'after the release', '2', 'D', 'no', '', 'closed')]).some((p) => p.includes('names its test')));
  assert.ok(run([row('S1-1', 'after the release', '2', 'D', 'no', 'tests/unit/a.test.ts: S1-1', 'closed')], [{ file: 'tests/unit/a.test.ts', name: 'a hang S1-1' }]).some((p) => p.includes('does not exist')));
  assert.deepEqual(run([row('S1-1', 'after the release', '2', 'D', 'no', 'tests/unit/a.test.ts: S1-1', 'closed')], [{ file: 'tests/unit/a.test.ts', name: 'S1-1: a hang' }]), []);
});

test('question 79: the parsers read sources from names', () => {
  assert.deepEqual(sourcesOf('tests 3, 4 and 5 and I-a-1, S2-3, check-slice §3.5, question 7'), { rows: [3, 4, 5], invariants: ['I-a-1'], findings: ['S2-3'], sections: [['check-slice', '3.5']], questions: [7] });
});
