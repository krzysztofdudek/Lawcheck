import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invariantsOf, loadInputs, problemsOf, rowsOf, scanTests, sectionLabels, sourcesOf, type Inputs } from './spec-map.ts';
import { SECTION_ONLY_TESTS } from '../numbers.ts';
import { namesProblems, tieProblems } from './tie.ts';

const REPO = new URL('../../', import.meta.url);

const table = (head: string, rows: string[]) => ['', `| ${head} |`, '|---|---|---|', ...rows, ''].join('\n');
const code = (...lines: string[]) => [`import { test, describe } from 'node:test';`, ...lines, ''].join('\n');

function inputs(over: Partial<Inputs> = {}): Inputs {
  return {
    specs: [{ path: 'design/promises.md', text: ['# Promises', '', table('Id | Promise | Test', ['| I-out-1 | p | tests/x.test.ts |'])].join('\n') }],
    docs: [],
    questions: '## 5. A question\n',
    sections: table('Section label | What it covers | Described in', ['| `one-slice §1` | the scope | docs/a.md |']),
    tests: [
      {
        path: 'tests/unit/a.test.ts',
        text: code(
          `test('test 1: a', () => { assert.equal(compute(1), 1); });`,
          `test('tests 2 and 1: c', () => { assert.equal(compute(1), 1); });`,
          `test('I-out-1: no forged line', () => { assert.equal(compute(1), 1); });`,
          `test('S1-1: a hang', () => { assert.equal(compute(1), 1); });`,
          `test('one-slice §1: scope', () => { assert.equal(compute(1), 1); });`,
          `test('question 5: a ruling', () => { assert.equal(compute(1), 1); });`,
        ),
      },
    ],
    sectionOnly: 2,
    harness: [],
    ...over,
  };
}

const withTests = (...lines: string[]): Partial<Inputs> => ({ tests: [{ path: 'tests/unit/a.test.ts', text: code(...lines) }] });
const all = ["test('test 1: a', () => { assert.equal(compute(1), 1); });", "test('tests 2: c', () => { assert.equal(compute(1), 1); });", "test('I-out-1: i', () => { assert.equal(compute(1), 1); });"];

test('question 79: every test leads its name with a source that exists, and every promise and harness check has a test', () => {
  assert.deepEqual(problemsOf(loadInputs(REPO, SECTION_ONLY_TESTS)), []);
});

test('question 79: control, a consistent small map has no problem', () => {
  assert.deepEqual(problemsOf(inputs()), []);
});

test('question 79: control, a test number needs no table, and a promise without a test is named', () => {
  assert.deepEqual(problemsOf(inputs({ ...withTests(...all, "test('test 9: a new acceptance test', () => { assert.equal(compute(1), 1); });"), sectionOnly: 0 })), []);
  const untested = problemsOf(inputs({ ...withTests("test('test 1: a', () => { assert.equal(compute(1), 1); });"), sectionOnly: 0 }));
  assert.ok(untested.includes('invariant I-out-1 of design/promises.md has no test with its id in the name'), untested.join('\n'));
  const twice = problemsOf(inputs({ docs: [{ path: 'docs/a.md', text: table('Id | Promise | Test', ['| I-out-1 | p | f.ts |']) }] }));
  assert.ok(twice.includes('invariant I-out-1 is used twice (again in docs/a.md)'), twice.join('\n'));
});

test('R-58: control, a test that does not run covers nothing', () => {
  const skipped = [
    "test.skip('test 2: skipped', () => { assert.equal(compute(1), 1); });",
    "test('test 2: skipped by option', { skip: true }, () => { assert.equal(compute(1), 1); });",
    "test('test 2: todo by option', { todo: 'later' }, () => { assert.equal(compute(1), 1); });",
    "test.todo('test 2: todo');",
    "// test('test 2: commented out', () => { assert.equal(compute(1), 1); });",
    "/* test('test 2: in a block comment', () => { assert.equal(compute(1), 1); }); */",
    "const s = \"test('test 2: in a string', () => { assert.equal(compute(1), 1); })\";",
    'const t = `test(\'test 2: in a template\', () => { assert.equal(compute(1), 1); })`;',
    "describe.skip('group', () => { test('test 2: in a skipped group', () => { assert.equal(compute(1), 1); }); });",
    "describe('group', { skip: true }, () => { test('test 2: in a group skipped by option', () => { assert.equal(compute(1), 1); }); });",
    "describe('group', { todo: true }, () => { test('test 2: in a todo group', () => { assert.equal(compute(1), 1); }); });",
    "const options = { skip: true }; test('test 2: options in a variable', options, () => { assert.equal(compute(1), 1); });",
  ];
  for (const line of skipped) {
    const problems = problemsOf(inputs({ ...withTests("test('test 1: a', () => { assert.equal(compute(1), 1); });", line.replaceAll('test 2: ', 'I-out-1: ')), sectionOnly: 0 }));
    assert.ok(problems.includes('invariant I-out-1 of design/promises.md has no test with its id in the name'), `${line}\n${problems.join('\n')}`);
  }
  const live = problemsOf(inputs({ ...withTests("test('test 1: a', () => { assert.equal(compute(1), 1); });", "test('I-out-1: runs', { skip: false }, () => { assert.equal(compute(1), 1); });"), sectionOnly: 0 }));
  assert.deepEqual(live, []);
});

test('R-59: control, a test call the rail cannot read, and a test in a place the runner does not run, are named', () => {
  const unreadable: [string, string][] = [
    ["test({ name: 'test 2: x' }, () => { assert.equal(compute(1), 1); });", 'is not a literal string'],
    ["const name = 'test 2: x'; test(name, () => { assert.equal(compute(1), 1); });", 'is not a literal string'],
    ['test(`${1}: test 2`, () => { assert.equal(compute(1), 1); });', 'is not a literal string'],
    ['test(`a name ${1}`, () => { assert.equal(compute(1), 1); });', 'is not a literal string'],
    ["suite('test 2: x', () => { assert.equal(compute(1), 1); });", 'suite() is not read'],
    ["test.only('test 2: x', () => { assert.equal(compute(1), 1); });", '.only is not allowed'],
    ['const check = test;', 'assigned to another name'],
  ];
  for (const [line, part] of unreadable) {
    const problems = problemsOf(inputs(withTests(...all, line)));
    assert.ok(problems.some((p) => p.includes(part)), `${line}\n${problems.join('\n')}`);
  }
  for (const head of ["import { test as it2 } from 'node:test';", "import * as nt from 'node:test';", "import { suite } from 'node:test';", "import check from 'node:test';"]) {
    const scanned = scanTests('tests/unit/a.test.ts', [head, "it2('test 1: a', () => { assert.equal(compute(1), 1); });"].join('\n'));
    assert.ok(scanned.problems.length > 0, head);
  }
  assert.ok(scanTests('tests/unit/a.test.ts', "test('test 1: a', () => { assert.equal(compute(1), 1); });").problems.some((p) => p.includes('imports nothing from node:test')));
  assert.deepEqual(scanTests('tests/unit/a.test.ts', code("import { describe, it } from 'node:test';", "describe('S1-1: group', () => { it('S1-1: inner', async (t) => { await t.test('S1-1: sub', () => { assert.equal(compute(1), 1); }); }); });")).tests.map((t) => t.name), ['S1-1: inner', 'S1-1: sub']);
});

test('R-60: control, a name leads with its source and a colon, and every source it cites exists', () => {
  const junk = problemsOf(inputs(withTests(...all, "test('test 1: and test 9999 and one-slice §9', () => { assert.equal(compute(1), 1); });", "test('a hang, S1-1', () => { assert.equal(compute(1), 1); });", "test('S1-1: a hang and S9-9', () => { assert.equal(compute(1), 1); });", "test('test 1: and question 6', () => { assert.equal(compute(1), 1); });", "test('test 1: and I-out-2', () => { assert.equal(compute(1), 1); });", "test('test 9999: a stray row', () => { assert.equal(compute(1), 1); });")));
  for (const part of ['a hang, S1-1" does not lead', 'one-slice §9', 'question 6', 'invariant I-out-2']) assert.ok(junk.some((p) => p.includes(part)), `${part}\n${junk.join('\n')}`);
  const none = problemsOf(inputs(withTests(...all, "test('something that works', () => { assert.equal(compute(1), 1); });")));
  assert.ok(none.some((p) => p.includes('names no source')), none.join('\n'));
  const lone = problemsOf(inputs(withTests("test('test 1: a', () => { assert.equal(compute(1), 1); });", "test('tests 2: c', () => { assert.equal(compute(1), 1); });")));
  assert.ok(lone.some((p) => p.includes('invariant I-out-1 of design/promises.md has no test')), lone.join('\n'));
  for (const name of ['test 600 files are read in parallel', 'test 2 and a row', 'tests 1 and 2 are covered', 'S1-1 is a hang', 'I-out-1 holds', 'one-slice §1 says so', 'question 5 answers it']) {
    const problems = problemsOf(inputs(withTests(...all, `test('${name}', () => { assert.equal(compute(1), 1); });`)));
    assert.ok(problems.some((p) => p.includes(`"${name}" does not lead with its source`) || p.includes(`"${name}" names no source`)), `${name}\n${problems.join('\n')}`);
  }
});

test('R-61: control, the tables are read strictly, and code fences hide nothing and add nothing', () => {
  const read = (text: string) => rowsOf({ path: 'spec/x.md', text });
  assert.ok(read(table('# | Do | See', ['| 1 | a | b |', '| 2a | c | d |'])).problems.some((p) => p.includes('"2a"')));
  assert.ok(read(table('# | Do | See', ['| 1 | a | b |', '| `2` | c | d |'])).problems.length > 0);
  assert.ok(read(table('Step | Do | See', ['| 1 | a | b |', '| 2 | c | d |'])).problems.some((p) => p.includes('looks like an acceptance table')));
  for (const head of ['ID', 'No', 'Nr', 'Row', 'id']) {
    assert.deepEqual(read(table(`${head} | Do | See`, ['| 7 | a | b |'])).rows.map((r) => r.number), [7], head);
    assert.ok(read(table(`${head} | Do | See`, ['| 7 | a | b |', '| seven | c | d |'])).problems.length > 0, head);
    assert.ok(read(table(`${head} | Do | See`, ['| seven | a | b |'])).problems.length > 0, head);
  }
  assert.ok(read(table('Step | Do | See', ['| 1 | a | b |', '| 2a | c | d |'])).problems.some((p) => p.includes('mixes numbers and other text')));
  assert.ok(read(table('Step | Do | See', ['| 1 | a | b |'])).problems.some((p) => p.includes('looks like an acceptance table')));
  assert.deepEqual(read(['```', '| # | Do | See |', '|---|---|---|', '| 7 | a | b |', '```'].join('\n')), { rows: [], problems: [] });
  const bad = invariantsOf({ path: 'spec/x.md', text: table('Id | Promise | Test', ['| I-frame-1 | p | f.ts |', '| I-Frame-2 | p | f.ts |', '| I-3 | p | f.ts |']) });
  assert.deepEqual(bad.invariants.map((i) => i.id), ['I-frame-1']);
  assert.equal(bad.problems.length, 2);
  const inDocs = problemsOf(inputs({ docs: [{ path: 'docs/a.md', text: table('Id | Promise | Test', ['| I-doc-1 | p | f.ts |']) }] }));
  assert.ok(inDocs.includes('invariant I-doc-1 of docs/a.md has no test with its id in the name'), inDocs.join('\n'));
  const fenced = problemsOf(inputs({ sections: [inputs().sections, '```', '| `one-slice §7` | hidden | docs/a.md |', '```'].join('\n'), ...withTests(...all, "test('one-slice §7: hidden', () => { assert.equal(compute(1), 1); });") }));
  assert.ok(fenced.some((p) => p.includes('one-slice §7')), fenced.join('\n'));
  assert.deepEqual([...sectionLabels(table('Section label | What it covers | Described in', ['| `check-slice §2` | a | b |', '| `dependency-slice §3.1` | c | d |', '| check | e | f |']))], ['check-slice §2', 'dependency-slice §3.1']);
});

test('question 79: control, the count of tests that cite only a section may only fall', () => {
  assert.ok(problemsOf(inputs({ sectionOnly: 1 })).some((p) => p.includes('the ratchet allows 1')));
  assert.ok(problemsOf(inputs({ sectionOnly: 3 })).some((p) => p.includes('lower SECTION_ONLY_TESTS')));
  const questions = '## 5. A question\n## 95. The machinery\n## 160. The own law\n';
  const outside = (path: string, name: string) => problemsOf(inputs({ questions, sectionOnly: 2, tests: [...inputs().tests, { path, text: code(`test('${name}', () => { assert.equal(compute(1), 1); });`) }] }));
  assert.deepEqual(outside('tests/contract/b.test.ts', 'question 95: the runner'), []);
  assert.deepEqual(outside('tests/acceptance/self-law-rules.test.ts', 'question 160: a rule of the own law'), []);
  for (const [path, name] of [['tests/unit/b.test.ts', 'question 95: the runner'], ['tests/contract/b.test.ts', 'question 160: a rule'], ['tests/contract/b.test.ts', 'question 5: a ruling'], ['tests/contract/b.test.ts', 'question 95: one-slice §1, the runner']]) {
    assert.ok(outside(path, name).some((p) => p.includes('the ratchet allows 2')), `${path}: ${name}`);
  }
});

test('question 79: the parsers read sources from names', () => {
  assert.deepEqual(sourcesOf('tests 3, 4 and 5: and I-a-1, harness-2, S2-3, check-slice §3.5, question 7'), { rows: [3, 4, 5], invariants: ['I-a-1'], harness: ['harness-2'], findings: ['S2-3'], sections: [['check-slice', '3.5']], questions: [7] });
});

test('R-62: control, a row or an invariant is covered only by a test that ran and passed in the run', () => {
  const base = inputs({ tests: [{ path: 'tests/unit/a.test.ts', text: code("test('test 1: a', () => { assert.equal(compute(1), 1); });", "test('tests 2: c', () => { assert.equal(compute(1), 1); });", "test('I-out-1: i', () => { assert.equal(compute(1), 1); });") }] });
  const files = ['tests/unit/a.test.ts'];
  assert.deepEqual(tieProblems(base, files, [{ file: files[0]!, name: 'test 1: a' }, { file: files[0]!, name: 'tests 2: c' }, { file: files[0]!, name: 'I-out-1: i' }]), []);
  const missing = tieProblems(base, files, [{ file: files[0]!, name: 'test 1: a' }, { file: files[0]!, name: 'I-out-1: i' }]);
  assert.equal(missing.length, 1);
  assert.ok(missing[0]!.startsWith('test 2 is carried by a test of this run and none of them ran and passed'), missing[0]);
  assert.equal(tieProblems(base, files, []).length, 3);
  assert.deepEqual(tieProblems(base, ['tests/unit/other.test.ts'], []), []);
  const left = [{ file: files[0]!, name: 'tests 2: c' }];
  assert.deepEqual(tieProblems(base, files, [{ file: files[0]!, name: 'test 1: a' }, { file: files[0]!, name: 'I-out-1: i' }], left), []);
  assert.equal(tieProblems(base, files, [{ file: files[0]!, name: 'test 1: a' }, { file: files[0]!, name: 'I-out-1: i' }], [{ file: files[0]!, name: 'test 1: a' }]).length, 1);
});

test('R-63: control, a harness invariant needs a test that leads with its id, and a test may lead with no other', () => {
  const lines = [...all, "test('harness-1: a run is checked', () => { assert.equal(compute(1), 1); });"];
  assert.deepEqual(problemsOf({ ...inputs(withTests(...lines)), harness: ['harness-1'], sectionOnly: 0 }), []);
  const unknown = problemsOf({ ...inputs(withTests(...lines, "test('harness-9: nothing', () => { assert.equal(compute(1), 1); });")), harness: ['harness-1'] });
  assert.ok(unknown.some((p) => p.includes('harness-9, which is no invariant')), unknown.join('\n'));
  const uncovered = problemsOf({ ...inputs(withTests(...all)), harness: ['harness-1'] });
  assert.ok(uncovered.includes('harness invariant harness-1 has no test with its id in the name'), uncovered.join('\n'));
});

test('R-53: control, no row hides: an indented table row is read, and a numbered row with no header is refused', () => {
  assert.deepEqual(rowsOf({ path: 'spec/s.md', text: ['| # | Do | See |', '|---|---|---|', '  | 5 | a | b |'].join('\n') }).rows.map((r) => r.number), [5]);
  const split = rowsOf({ path: 'spec/s.md', text: ['| # | Do | See |', '|---|---|---|', '| 1 | a | b |', '', '| 2 | c | d |'].join('\n') });
  assert.ok(split.problems.some((p) => p.includes('stands in a table with no header')), split.problems.join('\n'));
  const loose = invariantsOf({ path: 'docs/a.md', text: ['| Id | Promise | Test |', '|---|---|---|', '| I-a-1 | p | f |', '', '| I-a-2 | p | f |'].join('\n') });
  assert.ok(loose.problems.some((p) => p.includes('stands in a table with no header')), loose.problems.join('\n'));
});

test('R-54: control, a test name used twice in one file is named', () => {
  const twice = problemsOf(inputs(withTests(...all, "test('test 1: a', () => { assert.equal(compute(1), 1); });")));
  assert.ok(twice.some((p) => p.includes('is used by two tests of one file')), twice.join('\n'));
});

test('R-49: control, a test that asserts nothing is named: an empty body, a bare return', () => {
  const empty = ["test('test 1: a', () => {});", "test('test 1: a', async () => { return; });", "test('test 1: a', function () {\n  // nothing\n});", "test('test 1: a', async (t) => {\n  return;\n});"];
  for (const line of empty) {
    const scanned = scanTests('tests/unit/a.test.ts', code(line));
    assert.ok(scanned.problems.some((p) => p.includes('asserts nothing')), line);
  }
  assert.deepEqual(scanTests('tests/unit/a.test.ts', code("test('test 1: a', () => { assert.equal(compute(1), 1); });", "test('test 2: b', () => helper());")).problems, []);
});

test('R-51: control, a finding that leads a name is tied to a test that ran, and what a template name holds after its literal start is checked', () => {
  const files = ['tests/unit/a.test.ts'];
  const base = inputs({ tests: [{ path: files[0]!, text: code("test('S1-1: a hang', () => { assert.equal(compute(1), 1); });", "test('S1-10: another', () => { assert.equal(compute(1), 1); });", "test('tests 1 and 2: c', () => { assert.equal(compute(1), 1); });", "test('I-out-1: i', () => { assert.equal(compute(1), 1); });") }] });
  const ran = (...names: string[]) => names.map((name) => ({ file: files[0]!, name }));
  assert.deepEqual(tieProblems(base, files, ran('S1-1: a hang', 'S1-10: another', 'tests 1 and 2: c', 'I-out-1: i')), []);
  const skipped = tieProblems(base, files, ran('tests 1 and 2: c', 'I-out-1: i', 'S1-10: another'));
  assert.deepEqual(skipped, ['S1-1 is carried by a test of this run and none of them ran and passed: tests/unit/a.test.ts: S1-1: a hang']);
  assert.deepEqual(tieProblems(base, files, ran('tests 1 and 2: c', 'I-out-1: i', 'S1-10: another'), ran('S1-1: a hang')), []);
  const late = namesProblems(base, ran('S1-1: a key of I-out-9 characters', 'S1-1: a key of question 7'));
  assert.ok(late.some((p) => p.includes('invariant I-out-9')) && late.some((p) => p.includes('question 7')), late.join('\n'));
});

test('R-49: control, an assertion that cannot fail is named, and so is an assertion in a hook', () => {
  const bad = [
    "test('test 1: a', () => { assert.ok(true); });",
    "test('test 1: a', () => { assert(true); });",
    "test('test 1: a', () => { assert.ok(1); });",
    "test('test 1: a', () => { assert.ok('a string'); });",
    "test('test 1: a', () => { const x = f(); assert.equal(x, x); });",
    "test('test 1: a', () => { assert.deepEqual(a.b, a.b, 'same'); });",
    "test('test 1: a', () => { try { assert.equal(f(), 1); } catch (e) { console.log(e); } });",
  ];
  for (const line of bad) assert.ok(scanTests('tests/unit/a.test.ts', code(line)).problems.some((p) => p.includes('cannot fail') || p.includes('cannot fail the test')), line);
  const hooks = scanTests('tests/unit/a.test.ts', code("beforeEach(() => { assert.equal(f(), 1); });", "test('test 1: a', () => { assert.equal(g(), 2); });"));
  assert.ok(hooks.problems.some((p) => p.includes('in beforeEach() counts for no test')), hooks.problems.join('\n'));
  const timers = scanTests('tests/unit/a.test.ts', code("test('test 1: a', () => { setTimeout(() => assert.equal(f(), 1), 10); });"));
  assert.ok(timers.problems.some((p) => p.includes('callback of setTimeout()')), timers.problems.join('\n'));
  const named = [
    "function later() { assert.equal(f(), 1); }\ntest('test 1: a', () => { setTimeout(later, 30); });",
    "const later = () => { assert.equal(f(), 1); };\ntest('test 1: a', () => { setTimeout(later, 30); });",
    "const later = () => assert.equal(f(), 1);\ntest('test 1: a', () => { setTimeout(later, 30); });",
    "async function later() { assert.equal(f(), 1); }\ntest('test 1: a', () => { setImmediate(later); });",
    "test('test 1: a', () => { function later() { assert.equal(f(), 1); }\n  setTimeout(later.bind(null), 30); });",
  ];
  for (const line of named) assert.ok(scanTests('tests/unit/a.test.ts', code(line)).problems.some((p) => p.includes('callback of set') && p.includes('later')), line);
  const harmless = ["test('test 1: a', async () => { await new Promise((done) => setTimeout(done, 30)); assert.equal(f(), 1); });", "function tidy() { cleanup(); }\ntest('test 1: a', () => { setTimeout(tidy, 30); assert.equal(f(), 1); });"];
  for (const line of harmless) assert.deepEqual(scanTests('tests/unit/a.test.ts', code(line)).problems, [], line);
  const good = ["test('test 1: a', () => { assert.equal(f(), 1); });", "test('test 1: a', () => { try { assert.equal(f(), 1); } catch (e) { throw e; } });", "test('test 1: a', () => { assert.equal(f(1), f(2)); });", "test('test 1: a', () => { assert.ok(f()); });"];
  for (const line of good) assert.deepEqual(scanTests('tests/unit/a.test.ts', code(line)).problems, [], line);
});
