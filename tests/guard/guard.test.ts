import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCase, BASE, baseRepo, fixtureConfig, GIT_ENV, RATCHET, sh } from './fixture.ts';
import { withoutTypeStrippingWarning } from '../harness/warnings.ts';
import { approvalHash, judge, render, type Report } from './guard.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CASES = join(HERE, 'cases');

type Expect = { refused: string[] } | { cleared: string[] };

const EXPECT: { [name: string]: Expect } = {
  'refused-expected-no-record': { refused: ['expected-changed'] },
  'refused-expected-anchor-missing': { refused: ['expected-changed'] },
  'refused-expected-anchor-unchanged': { refused: ['expected-changed'] },
  'refused-expected-ruling-missing': { refused: ['expected-changed'] },
  'refused-expected-runes-unmoved': { refused: ['expected-changed'] },
  'refused-expected-reviewer-unnamed': { refused: ['expected-changed'] },
  'refused-expected-wrong-kind': { refused: ['expected-changed', 'record-invalid'] },
  'refused-test-removed': { refused: ['test-removed'] },
  'refused-test-renamed': { refused: ['test-removed'] },
  'refused-test-removed-anchor-not-named': { refused: ['test-removed'] },
  'refused-promise-reworded-by-reviewer': { refused: ['promise-changed'] },
  'refused-invariant-removed-by-reviewer': { refused: ['promise-changed'] },
  'refused-promise-example-by-reviewer': { refused: ['promise-changed'] },
  'refused-codes-example-by-reviewer': { refused: ['promise-changed'] },
  'refused-guard-by-reviewer': { refused: ['guard-changed'] },
  'refused-guard-config-by-reviewer': { refused: ['guard-changed'] },
  'refused-ci-workflow-by-reviewer': { refused: ['ci-changed'] },
  'refused-ci-scripts-by-reviewer': { refused: ['ci-changed'] },
  'refused-threshold-by-reviewer': { refused: ['threshold-lowered'] },
  'refused-threshold-no-record': { refused: ['threshold-lowered'] },
  'refused-threshold-seed-changed': { refused: ['threshold-lowered'] },
  'refused-threshold-removed': { refused: ['threshold-lowered'] },
  'refused-threshold-direction-turned': { refused: ['threshold-lowered'] },
  'refused-number-unreadable': { refused: ['number-unreadable', 'threshold-lowered'] },
  'refused-numbers-code-changed': { refused: ['threshold-lowered'] },
  'refused-numbers-budget-through-new-number': { refused: ['threshold-lowered'] },
  'refused-numbers-value-after-as': { refused: ['number-unreadable', 'threshold-lowered', 'threshold-lowered'] },
  'refused-test-names-larger-budget': { refused: ['threshold-lowered'] },
  'refused-test-names-new-number-budget': { refused: ['threshold-lowered'] },
  'refused-test-gains-budget': { refused: ['threshold-lowered'] },
  'refused-ratchet-grew': { refused: ['ratchet-grew'] },
  'refused-number-unclassified': { refused: ['number-unclassified'] },
  'refused-owner-row-from-branch': { refused: ['guard-changed'] },
  'refused-owner-row-alone-short': { refused: ['record-invalid'] },
  'refused-owner-row-alone-by-reviewer': { refused: ['record-invalid'] },
  'refused-owner-row-alone-no-anchor': { refused: ['record-invalid'] },
  'refused-weakenings-old-row-edited': { refused: ['weakenings-rewritten', 'record-invalid'] },
  'refused-weakenings-old-row-removed': { refused: ['weakenings-rewritten'] },
  'refused-only-added': { refused: ['only-added'] },
  'refused-only-option-added': { refused: ['only-added'] },
  'refused-todo-added': { refused: ['todo-added'] },
  'refused-skip-unlisted': { refused: ['skip-unlisted'] },
  'refused-skip-option-unlisted': { refused: ['skip-unlisted'] },
  'refused-skip-hidden-return': { refused: ['skip-unlisted'] },
  'refused-skip-modifier': { refused: ['skip-unlisted'] },
  'refused-platform-part-unlisted': { refused: ['skip-unlisted'] },
  'refused-slow-test-added': { refused: ['ratchet-grew'] },
  'refused-slow-test-budget-raised': { refused: ['threshold-lowered'] },
  'refused-schema-no-record': { refused: ['expected-changed'] },
  'refused-sabotage-removed-guard-kept': { refused: ['sabotage-guard-kept', 'record-invalid'] },
  'refused-sabotage-removed-test-kept': { refused: ['sabotage-guard-kept', 'record-invalid'] },
  'refused-sabotage-changed': { refused: ['sabotage-changed'] },
  'refused-harness-no-record': { refused: ['harness-changed'] },
  'refused-docs-example-no-record': { refused: ['docs-example-changed'] },
  'refused-law-no-record': { refused: ['law-changed'] },
  'refused-platform-test-narrowed': { refused: ['platform-narrowed', 'harness-changed'] },
  'refused-platform-promise-test-dropped': { refused: ['platform-narrowed', 'platform-unlisted', 'harness-changed'] },
  'refused-platform-promise-dropped': { refused: ['platform-narrowed', 'harness-changed'] },
  'refused-platform-promise-added-unlisted': { refused: ['platform-unlisted', 'harness-changed'] },
  'refused-platform-promise-skipped-elsewhere': { refused: ['platform-unlisted'] },
  'refused-self-law-waiver-added': { refused: ['ratchet-grew'] },
  'refused-section-only-raised': { refused: ['threshold-lowered'] },
  'refused-platform-skip-added': { refused: ['harness-changed', 'ratchet-grew'] },
  'refused-self-law-unsorted-grows': { refused: ['ratchet-grew'] },
  'accepted-expected-runes': { cleared: ['expected-changed'] },
  'accepted-expected-ruling': { cleared: ['expected-changed'] },
  'accepted-test-removed-finding': { cleared: ['test-removed'] },
  'accepted-test-removed-with-row': { cleared: ['test-removed'] },
  'accepted-promise-by-owner': { cleared: ['promise-changed'] },
  'accepted-guard-by-owner': { cleared: ['guard-changed', 'guard-changed'] },
  'accepted-owner-row-alone': { cleared: [] },
  'accepted-ci-by-owner': { cleared: ['ci-changed', 'ci-changed'] },
  'accepted-threshold-by-owner': { cleared: ['threshold-lowered'] },
  'accepted-threshold-stronger': { cleared: [] },
  'accepted-new-number-with-direction': { cleared: [] },
  'accepted-numbers-comment-changed': { cleared: [] },
  'accepted-numbers-code-by-owner': { cleared: ['threshold-lowered'] },
  'accepted-ratchet-shrinks': { cleared: [] },
  'accepted-slow-test-removed': { cleared: [] },
  'accepted-slow-test-added-ruling': { cleared: ['ratchet-grew'] },
  'accepted-ratchet-grew-ruling': { cleared: ['ratchet-grew'] },
  'accepted-skip-platform': { cleared: [] },
  'accepted-sabotage-removed': { cleared: ['sabotage-removed', 'test-removed'] },
  'accepted-harness-by-reviewer': { cleared: ['harness-changed'] },
  'accepted-law-by-reviewer': { cleared: ['law-changed'] },
  'accepted-platform-narrowed-by-reviewer': { cleared: ['platform-narrowed', 'harness-changed'] },
  'accepted-platform-promise-added-listed': { cleared: ['harness-changed', 'harness-changed'] },
  'accepted-platform-promise-skipped-whole': { cleared: ['harness-changed'] },
  'accepted-platform-promise-nightly': { cleared: [] },
  'accepted-platform-row-not-leading': { cleared: [] },
  'accepted-self-law-shrinks': { cleared: [] },
  'accepted-platform-skip-removed': { cleared: ['harness-changed'] },
  'accepted-new-test': { cleared: [] },
  'accepted-new-test-names-budget': { cleared: [] },
  'accepted-test-names-smaller-budget': { cleared: [] },
  'accepted-test-moved': { cleared: [] },
  'accepted-docs-example-ruling': { cleared: ['docs-example-changed'] },
};

function caseBase(name: string): { [path: string]: string } {
  const rows = join(CASES, `${name}.base.md`);
  const files = join(CASES, `${name}.base.json`);
  const withRows = existsSync(rows) ? { ...BASE, 'tests/weakenings.md': BASE['tests/weakenings.md'] + readFileSync(rows, 'utf8') } : BASE;
  if (!existsSync(files)) return withRows;
  const lines = JSON.parse(readFileSync(files, 'utf8')) as { [path: string]: string[] };
  return { ...withRows, ...Object.fromEntries(Object.entries(lines).map(([path, text]) => [path, text.join('\n')])) };
}

function judgeCase(name: string): Report {
  const repo = baseRepo(caseBase(name));
  try {
    applyCase(repo, join(CASES, `${name}.diff`));
    return judge(repo.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
  } finally {
    repo.done();
  }
}

test('question 95: the suite guard, every case on disk has an expectation, and every expectation a case', () => {
  const onDisk = readdirSync(CASES).filter((f) => f.endsWith('.diff')).map((f) => f.slice(0, -5)).sort();
  for (const rows of readdirSync(CASES).filter((f) => f.endsWith('.base.md'))) assert.ok(onDisk.includes(rows.slice(0, -8)), rows);
  for (const files of readdirSync(CASES).filter((f) => f.endsWith('.base.json'))) assert.ok(onDisk.includes(files.slice(0, -10)), files);
  assert.deepEqual(onDisk, Object.keys(EXPECT).sort());
  assert.ok(onDisk.filter((n) => n.startsWith('refused-')).length >= 30);
});

for (const [name, expect] of Object.entries(EXPECT)) {
  test(`question 95: the suite guard, case ${name}`, () => {
    const report = judgeCase(name);
    const text = render(report);
    const refused = report.findings.filter((f) => !f.cleared).map((f) => f.kind).sort();
    const cleared = report.findings.filter((f) => f.cleared).map((f) => f.kind).sort();
    if ('refused' in expect) {
      assert.equal(report.passed, false, text);
      assert.deepEqual(refused, [...expect.refused].sort(), text);
      assert.match(text.trimEnd().split('\n').at(-1)!, /^suite guard: FAIL {2}\d+ weakenings? without a valid record \(/);
      for (const f of report.findings.filter((x) => !x.cleared)) assert.ok(text.includes(`REFUSED  ${f.kind}  ${f.subject}`), text);
    } else {
      assert.deepEqual(refused, [], text);
      assert.deepEqual(cleared, [...expect.cleared].sort(), text);
      assert.equal(report.passed, true, text);
      assert.match(text.trimEnd().split('\n').at(-1)!, /^suite guard: PASS {2}/);
    }
  });
}

test('question 95: the suite guard, a refusal names the weakening, the record that would pass it, and the anchors that count', () => {
  const text = render(judgeCase('refused-test-removed'));
  assert.equal(text, [
    'REFUSED  test-removed  test 2: the passing run',
    'where    tests/acceptance/cli.test.ts:8',
    'what     removed or renamed',
    'why      no record of it in this change',
    'needs    a row added to tests/weakenings.md in this change:',
    '         | 2026-11-15 | test 2: the passing run | test-removed | <why the suite may get weaker here> | <anchor> | reviewer <the fresh reviewer agent> |',
    "anchor   the test number ('test <n>') or finding ('S<r>-<n>') that the test's name leads with, or a promise ('I-...') it names whose row this change also changes; or 'ruling <n>' of design/decisions.md; or 'Runes <version>' that this change moves to",
    '',
    text.trimEnd().split('\n').at(-1),
    '',
  ].join('\n'));
});

test('question 95: the suite guard, a record of an owner kind that the branch brings is refused, whoever it names', () => {
  for (const name of ['refused-guard-by-reviewer', 'refused-owner-row-from-branch']) {
    const report = judgeCase(name);
    const finding = report.findings.find((f) => f.kind === 'guard-changed')!;
    assert.deepEqual(finding.why, [`the record at tests/weakenings.md:6: a record of guard-changed counts only when it is already on the base ${report.base.slice(0, 7)}: the owner's row lands there first, in a change of its own, and a branch never brings its own`], name);
    assert.ok(render(report).includes("needs    the owner's row in tests/weakenings.md on the base, landed there first in a change of its own:"), name);
  }
});

test('question 95: the suite guard, an owner\'s row lands alone first, and the change it approves passes once the row is on the base', () => {
  const lone = judgeCase('accepted-owner-row-alone');
  assert.equal(lone.passed, true, render(lone));
  assert.deepEqual(lone.records.map((r) => [r.matched, r.valid]), [[false, true]]);
  const repo = baseRepo(BASE);
  try {
    applyCase(repo, join(CASES, 'accepted-owner-row-alone.diff'));
    sh(repo.dir, ['checkout', '-q', 'main']);
    sh(repo.dir, ['merge', '-q', '--ff-only', 'work']);
    sh(repo.dir, ['checkout', '-q', '-b', 'later']);
    writeFileSync(join(repo.dir, 'tests/guard/check.ts'), 'export const GUARD = false;\n');
    writeFileSync(join(repo.dir, 'tests/guard/config.json'), '{ "directions": { "PROPERTY_CASES": "higher" } }\n');
    sh(repo.dir, ['commit', '-q', '-a', '-m', 'the guard changes']);
    const report = judge(repo.dir, 'main', 'later', fixtureConfig(), '2026-11-15');
    assert.equal(report.passed, true, render(report));
    assert.deepEqual(report.findings.map((f) => f.kind), ['guard-changed', 'guard-changed']);
  } finally {
    repo.done();
  }
});

test('question 95: the suite guard, the record of a removed test that anchors a finding the name does not lead with is refused', () => {
  const finding = judgeCase('refused-test-removed-anchor-not-named').findings.find((f) => f.kind === 'test-removed')!;
  assert.deepEqual(finding.why, ['the record at tests/weakenings.md:6: the test\'s name names test 2, and the record anchors S1-1']);
});

test('question 95: the suite guard, a sabotage entry removed with its code is refused while a test still carries its promise', () => {
  const finding = judgeCase('refused-sabotage-removed-test-kept').findings.find((f) => f.kind === 'sabotage-guard-kept')!;
  assert.equal(finding.detail, 'an entry of the sabotage list is removed only with the guard it breaks and with its promise: its promise test 3 still exists');
});

test('question 95: the suite guard, test N and row N are one key, in an anchor and in a sabotage promise', () => {
  const entries = JSON.parse(BASE['tests/sabotage/list.json']!) as Array<{ id: string; promise: string }>;
  const withTestPromise = entries.map((e) => (e.id === 'limit-50' ? { ...e, promise: 'test 3' } : e));
  const without = entries.filter((e) => e.id !== 'limit-50');
  const json = (list: unknown[]): string => `${JSON.stringify(list, null, 2)}\n`;
  const limitGone = 'export function lines(all: string[]): string[] {\n  return all;\n}\n';
  const testGone = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n\n";
  for (const anchor of ['row 3', 'test 3']) {
    const repo = baseRepo({ ...BASE, 'tests/sabotage/list.json': json(withTestPromise) });
    try {
      writeFileSync(join(repo.dir, 'tests/sabotage/list.json'), json(without));
      writeFileSync(join(repo.dir, 'src/output.ts'), limitGone);
      writeFileSync(join(repo.dir, 'tests/acceptance/limits.test.ts'), testGone);
      writeFileSync(join(repo.dir, 'tests/weakenings.md'), `${BASE['tests/weakenings.md']}| 2026-11-15 | test 3: at most 50 finding lines | test-removed | every finding is printed | ${anchor} | reviewer fresh-agent-7 |\n| 2026-11-15 | limit-50 | sabotage-removed | the limit and its test are gone | ${anchor} | reviewer fresh-agent-7 |\n`);
      sh(repo.dir, ['commit', '-q', '-a', '-m', 'the limit and its test go']);
      const report = judge(repo.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
      assert.equal(report.passed, true, render(report));
      assert.deepEqual(report.findings.map((f) => [f.kind, f.cleared]).sort(), [['sabotage-removed', true], ['test-removed', true]], anchor);
    } finally {
      repo.done();
    }
  }
  const kept = baseRepo({ ...BASE, 'tests/sabotage/list.json': json(withTestPromise) });
  try {
    writeFileSync(join(kept.dir, 'tests/sabotage/list.json'), json(without));
    writeFileSync(join(kept.dir, 'src/output.ts'), limitGone);
    sh(kept.dir, ['commit', '-q', '-a', '-m', 'the entry and its code go, the test stays']);
    const finding = judge(kept.dir, 'main', 'work', fixtureConfig(), '2026-11-15').findings.find((f) => f.kind === 'sabotage-guard-kept')!;
    assert.equal(finding.detail, 'an entry of the sabotage list is removed only with the guard it breaks and with its promise: its promise test 3 still exists');
  } finally {
    kept.done();
  }
});

test('question 95: the suite guard, an owner\'s row that lands alone is refused for what is wrong with the row itself', () => {
  const detail = (name: string): string[] => judgeCase(name).findings.filter((f) => f.kind === 'record-invalid').flatMap((f) => [f.detail]);
  assert.deepEqual(detail('refused-owner-row-alone-short'), ['not a record: it has 5 cells, the table has 6']);
  assert.deepEqual(detail('refused-owner-row-alone-by-reviewer'), ['guard-changed needs the approval of owner, and reviewer approved it']);
  assert.deepEqual(detail('refused-owner-row-alone-no-anchor'), ["'not an anchor at all' is not an anchor (test <n>, I-..., S<r>-<n>, ruling <n>, Runes <version>, or a path)"]);
});

test('question 95: the suite guard, an owner\'s row on the base covers only the change it approves, so a later change of the same paths is refused', () => {
  const base = caseBase('accepted-guard-by-owner');
  const approved = /approves ([0-9a-f]{16})/.exec(base['tests/weakenings.md']!)![1]!;
  const reused = baseRepo(base);
  try {
    writeFileSync(join(reused.dir, 'tests/guard/check.ts'), 'export const GUARD = 2;\n');
    writeFileSync(join(reused.dir, 'tests/guard/config.json'), '{ "ratchets": ["another"] }\n');
    sh(reused.dir, ['commit', '-q', '-a', '-m', 'another change of the guard']);
    const report = judge(reused.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
    const finding = report.findings.find((f) => f.kind === 'guard-changed')!;
    assert.equal(finding.cleared, false);
    assert.equal(finding.why.length, 1, finding.why.join('\n'));
    assert.match(finding.why[0]!, new RegExp(`^the record at the base's tests/weakenings\\.md:6: it approves the change ${approved}, and this change is [0-9a-f]{16}: an owner's record covers only the change it was made for$`));
    assert.ok(render(report).includes(`| tests/guard/** | guard-changed | <why the suite may get weaker here> | <anchor>; approves ${approvalHash(report.findings.filter((f) => f.kind === 'guard-changed'))} | owner |`), render(report));
  } finally {
    reused.done();
  }
  const unbound = baseRepo({ ...base, 'tests/weakenings.md': base['tests/weakenings.md']!.replace(/; approves [0-9a-f]{16}/, '') });
  try {
    applyCase(unbound, join(CASES, 'accepted-guard-by-owner.diff'));
    const finding = judge(unbound.dir, 'main', 'work', fixtureConfig(), '2026-11-15').findings.find((f) => f.kind === 'guard-changed')!;
    assert.equal(finding.cleared, false);
    assert.deepEqual(finding.why, [`the record at the base's tests/weakenings.md:6: it names no change it approves; for this change the anchor holds 'approves ${approved}'`]);
  } finally {
    unbound.done();
  }
});

test('question 95: the suite guard, a record of an owner kind on the base that a reviewer approved does not count', () => {
  const rows = '| 2026-11-15 | tests/guard/** | guard-changed | simpler | tests/guard/check.ts | reviewer fresh-agent-7 |\n';
  const repo = baseRepo({ ...BASE, 'tests/weakenings.md': BASE['tests/weakenings.md'] + rows });
  try {
    applyCase(repo, join(CASES, 'refused-harness-no-record.diff'));
    sh(repo.dir, ['checkout', '-q', 'HEAD~1', '--', '.']);
    writeFileSync(join(repo.dir, 'tests/guard/check.ts'), 'export const GUARD = false;\n');
    sh(repo.dir, ['commit', '-q', '-a', '-m', 'the guard changes']);
    const report = judge(repo.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
    const finding = report.findings.find((f) => f.kind === 'guard-changed')!;
    assert.equal(finding.cleared, false);
    assert.deepEqual(finding.why.slice(0, 1), ["the record at the base's tests/weakenings.md:6: guard-changed needs the approval of owner, and reviewer approved it"]);
  } finally {
    repo.done();
  }
});

test('question 95: the suite guard, an anchor that does not exist, and one this change does not touch, are named as such', () => {
  const missing = judgeCase('refused-expected-anchor-missing').findings.find((f) => f.kind === 'expected-changed')!;
  assert.deepEqual(missing.why, ["the record at tests/weakenings.md:6: the anchor 'test 99' does not exist in the names of the tests"]);
  const unchanged = judgeCase('refused-expected-anchor-unchanged').findings.find((f) => f.kind === 'expected-changed')!;
  assert.deepEqual(unchanged.why, ["the record at tests/weakenings.md:6: the anchor 'test 2' exists, but this change does not add, reword or remove it"]);
});

test('question 95: the suite guard, who may approve each kind is configuration', () => {
  const repo = baseRepo();
  try {
    applyCase(repo, join(CASES, 'refused-guard-by-reviewer.diff'));
    const config = fixtureConfig();
    assert.equal(judge(repo.dir, 'main', 'work', config, '2026-11-15').passed, false);
    config.approvers['guard-changed'] = ['owner', 'reviewer'];
    assert.equal(judge(repo.dir, 'main', 'work', config, '2026-11-15').passed, true);
  } finally {
    repo.done();
  }
});

test('question 95: the suite guard, a number with no direction in tests/numbers.ts fails even when nothing else changed', () => {
  const repo = baseRepo({ ...BASE, 'tests/numbers.ts': BASE['tests/numbers.ts']!.replace("SEED: 'fixed', ", '') });
  try {
    applyCase(repo, join(CASES, 'accepted-new-test.diff'));
    const report = judge(repo.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
    assert.deepEqual(report.findings.map((f) => [f.kind, f.subject, f.cleared]), [['number-unclassified', 'SEED', false]]);
  } finally {
    repo.done();
  }
});

function ownGuard(): { [path: string]: string } {
  const own: { [path: string]: string } = {};
  for (const file of readdirSync(HERE)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    own[`tests/guard/${file}`] = readFileSync(join(HERE, file), 'utf8');
  }
  own['tests/guard/config.json'] = `${JSON.stringify({ ...JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8')), ratchets: [RATCHET] }, null, 2)}\n`;
  return own;
}

function guardRepo(headGuardPatch: (text: string) => string): { dir: string; done: () => void } {
  const files = { ...BASE, ...ownGuard() };
  delete files['tests/guard/check.ts'];
  const repo = baseRepo(files);
  applyCase(repo, join(CASES, 'refused-expected-no-record.diff'));
  const guardFile = join(repo.dir, 'tests/guard/guard.ts');
  writeFileSync(guardFile, headGuardPatch(readFileSync(guardFile, 'utf8')));
  sh(repo.dir, ['commit', '-q', '-a', '-m', 'the branch edits its judge']);
  return { dir: repo.dir, done: repo.done };
}

test('question 95: the suite guard, the judge is the guard of the base, so a branch that edits its own guard is still refused', () => {
  const repo = guardRepo((text) => text.replace('passed: findings.every((f) => f.cleared)', 'passed: true'));
  try {
    const head = spawnSync(process.execPath, ['tests/guard/cli.ts', '--base', 'main', '--head', 'work'], { cwd: repo.dir, env: GIT_ENV, encoding: 'utf8' });
    assert.equal(head.status, 0, 'the branch\'s own guard lets itself pass');
    const run = spawnSync(process.execPath, [join(HERE, 'from-base.ts'), '--repo', repo.dir, '--base', 'main', '--head', 'work'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.equal(withoutTypeStrippingWarning(run.stderr), '');
    assert.ok(run.stdout.includes('REFUSED  expected-changed  tests/real/hono.expected'), run.stdout);
    assert.ok(run.stdout.includes('REFUSED  guard-changed  tests/guard/guard.ts'), run.stdout);
    assert.match(run.stdout.trimEnd().split('\n').at(-1)!, /^suite guard: FAIL {2}2 weakenings without a valid record \(/);
  } finally {
    repo.done();
  }
});

test('question 95: the suite guard, the base\'s guard copied into a temporary folder behind a link, as macOS keeps it, still judges and refuses', () => {
  const repo = guardRepo((text) => text.replace('passed: findings.every((f) => f.cleared)', 'passed: true'));
  const outer = mkdtempSync(join(tmpdir(), 'lawcheck-guard-link-'));
  try {
    const real = join(outer, 'real');
    const temp = join(outer, 'temp');
    mkdirSync(real);
    symlinkSync(real, temp, process.platform === 'win32' ? 'junction' : 'dir');
    const run = spawnSync(process.execPath, [join(HERE, 'from-base.ts'), '--repo', repo.dir, '--base', 'main', '--head', 'work'], { env: { ...GIT_ENV, TMPDIR: temp, TEMP: temp, TMP: temp }, encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.equal(withoutTypeStrippingWarning(run.stderr), '');
    assert.ok(run.stdout.includes('REFUSED  expected-changed  tests/real/hono.expected'), run.stdout);
    assert.ok(run.stdout.includes('REFUSED  guard-changed  tests/guard/guard.ts'), run.stdout);
    assert.match(run.stdout.trimEnd().split('\n').at(-1)!, /^suite guard: FAIL {2}2 weakenings without a valid record \(/);
    assert.deepEqual(readdirSync(real), []);
  } finally {
    rmSync(outer, { recursive: true, force: true });
    repo.done();
  }
});

test('question 95: the suite guard, with no guard on the base, the entry point says not judged and passes', () => {
  const files = { ...BASE };
  for (const path of Object.keys(files)) if (path.startsWith('tests/guard/') || path === 'tests/weakenings.md') delete files[path];
  const repo = baseRepo(files);
  try {
    writeFileSync(join(repo.dir, 'tests/real/hono.expected'), 'src/index.ts  ok\n');
    sh(repo.dir, ['commit', '-q', '-a', '-m', 'a weakening']);
    const run = spawnSync(process.execPath, [join(HERE, 'from-base.ts'), '--repo', repo.dir, '--base', 'main', '--head', 'work'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(withoutTypeStrippingWarning(run.stderr), '');
    assert.equal(run.status, 0);
    assert.match(run.stdout, /^suite guard: not judged {2}the base [0-9a-f]{7} has no suite guard yet\n$/);
    const zero = spawnSync(process.execPath, [join(HERE, 'from-base.ts'), '--repo', repo.dir, '--base', '0000000000000000000000000000000000000000', '--head', 'work'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(zero.status, 0);
    assert.equal(zero.stdout, 'suite guard: not judged  no base commit (0000000000000000000000000000000000000000)\n');
  } finally {
    repo.done();
  }
});

test('question 95: the suite guard, a base that holds the guard\'s files but not its entry point fails as could not run', () => {
  for (const keep of ['tests/guard/check.ts', 'tests/weakenings.md']) {
    const files = { ...BASE };
    for (const path of Object.keys(files)) if ((path.startsWith('tests/guard/') || path === 'tests/weakenings.md') && path !== keep) delete files[path];
    const repo = baseRepo(files);
    try {
      const run = spawnSync(process.execPath, [join(HERE, 'from-base.ts'), '--repo', repo.dir, '--base', 'main', '--head', 'work'], { env: GIT_ENV, encoding: 'utf8' });
      assert.equal(run.status, 1, keep);
      assert.match(run.stdout, new RegExp(`^suite guard: could not run {2}the base [0-9a-f]{7} holds ${keep === 'tests/weakenings.md' ? 'tests/weakenings\\.md' : 'tests/guard'} but no tests/guard/cli\\.ts\\n$`), keep);
    } finally {
      repo.done();
    }
  }
});

test('question 95: the suite guard, the command exits 2 with a reason when it cannot judge', () => {
  const repo = baseRepo();
  try {
    const run = spawnSync(process.execPath, [join(HERE, 'cli.ts'), '--repo', repo.dir, '--base', 'nope'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.equal(run.stdout, '');
    assert.equal(withoutTypeStrippingWarning(run.stderr), `suite guard: could not run: the base 'nope' is not a commit in ${repo.dir}\n`);
    const usage = spawnSync(process.execPath, [join(HERE, 'cli.ts'), '--bogus'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(usage.status, 2);
    assert.equal(withoutTypeStrippingWarning(usage.stderr), "suite guard: unknown argument '--bogus'\nusage: node tests/guard/cli.ts [--repo <dir>] [--base <rev>] [--head <rev>] [--json]\n");
  } finally {
    repo.done();
  }
});

const WORKFLOWS = ['ci', 'weekly', 'nightly'];

function workflowRepo(ledger: string): ReturnType<typeof baseRepo> {
  const files = { ...BASE, 'tests/weakenings.md': BASE['tests/weakenings.md']! + ledger };
  for (const name of WORKFLOWS) files[`.github/workflows/${name}.yml`] = `name: ${name}\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n`;
  const repo = baseRepo(files);
  for (const name of WORKFLOWS) writeFileSync(join(repo.dir, `.github/workflows/${name}.yml`), `name: ${name}\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm test\n`);
  sh(repo.dir, ['commit', '-q', '-a', '-m', 'the workflows change']);
  return repo;
}

test('R-116: the row the guard suggests for several refused files of a folder, landed on the base as printed, passes them, though another file of the folder is refused for another reason', () => {
  const heldRow = '| 2026-11-17 | .github/workflows/nightly.yml | ci-changed | an earlier change of this file | .github/workflows/nightly.yml; approves 0123456789abcdef | owner |\n';
  const suggested: string[] = [];
  const first = workflowRepo(heldRow);
  try {
    const report = judge(first.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
    assert.deepEqual(report.findings.map((f) => [f.kind, f.subject, f.cleared]), [...WORKFLOWS].sort().map((name) => ['ci-changed', `.github/workflows/${name}.yml`, false]));
    const text = render(report);
    for (const line of text.split('\n')) if (line.trim().startsWith('| 2026-11-15 |')) suggested.push(line.trim().replace('<why the suite may get weaker here>', 'the workflows install first').replace('<anchor>', '.github/workflows/ci.yml'));
    assert.equal(suggested.length, 2, text);
    assert.ok(suggested.some((row) => row.includes('| .github/workflows/** |')), text);
  } finally {
    first.done();
  }
  const landed = workflowRepo(`${heldRow}${suggested.join('\n')}\n`);
  try {
    const report = judge(landed.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
    assert.deepEqual(report.findings.filter((f) => !f.cleared).map((f) => [f.subject, f.why]), []);
    assert.equal(report.passed, true, render(report));
  } finally {
    landed.done();
  }
});

function manyExpected(files: { [path: string]: string }): { dir: string; root: string; done: () => void } {
  const repo = baseRepo({ ...files, ...Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`tests/real/case-${i}.expected`, 'a\n'])) });
  for (let i = 0; i < 400; i++) writeFileSync(join(repo.dir, `tests/real/case-${i}.expected`), 'b\n');
  sh(repo.dir, ['commit', '-q', '-a', '-m', 'four hundred expected outputs change']);
  return repo;
}

function toFileAndToPipe(entry: string, repo: { dir: string; root: string }): { file: string; pipe: string } {
  const args = [entry, '--repo', repo.dir, '--base', 'main', '--head', 'work', '--json'];
  const target = join(repo.root, 'report.json');
  const fd = openSync(target, 'w');
  try {
    spawnSync(process.execPath, args, { env: GIT_ENV, stdio: ['ignore', fd, 'pipe'] });
  } finally {
    closeSync(fd);
  }
  const piped = spawnSync(process.execPath, args, { env: GIT_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { file: readFileSync(target, 'utf8'), pipe: piped.stdout };
}

test('R-118: the report of the guard reaches a pipe whole, as it reaches a file, from the command and from the base\'s copy of it', () => {
  const direct = manyExpected(BASE);
  try {
    const out = toFileAndToPipe(join(HERE, 'cli.ts'), direct);
    assert.ok(out.file.length > 200_000, `the report is ${out.file.length} bytes`);
    assert.equal(out.pipe.length, out.file.length);
    assert.equal(out.pipe, out.file);
  } finally {
    direct.done();
  }
  const copied = manyExpected({ ...BASE, ...ownGuard() });
  try {
    const out = toFileAndToPipe(join(HERE, 'from-base.ts'), copied);
    assert.ok(out.file.length > 200_000, `the report is ${out.file.length} bytes`);
    assert.equal(out.pipe, out.file);
  } finally {
    copied.done();
  }
});

const BUDGET_NUMBERS = [
  'export const SEED = 20261115;',
  'export const RUN_BUDGET_MS = 20_000;',
  'export const LEFTOVER_GRACE_MS = 2_000;',
  'export const LIMITS_RUN_MS = 120_000;',
  'export const LIMITS_LARGE_RUN_MS = 300_000;',
  'export const LIMITS_RULES_RUN_MS = 400_000;',
  "export const stronger: Record<string, 'higher' | 'lower' | 'fixed'> = { SEED: 'fixed', RUN_BUDGET_MS: 'lower', LEFTOVER_GRACE_MS: 'lower', LIMITS_RUN_MS: 'lower', LIMITS_LARGE_RUN_MS: 'lower', LIMITS_RULES_RUN_MS: 'lower' };",
  '',
].join('\n');

function budgetChange(before: string[], after: string[]): Report {
  const file = (tests: string[]): string => ["import { test } from 'node:test';", "import { run } from '../harness/run.ts';", '', ...tests, ''].join('\n');
  const repo = baseRepo({ ...BASE, 'tests/numbers.ts': BUDGET_NUMBERS, 'tests/limits/large.test.ts': file(before) });
  try {
    writeFileSync(join(repo.dir, 'tests/limits/large.test.ts'), file(after));
    sh(repo.dir, ['commit', '-q', '--allow-empty', '-a', '-m', 'the budgets change']);
    return judge(repo.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
  } finally {
    repo.done();
  }
}

const call = (budget: string | null, title = 'test 4: a large run ends in time'): string[] => [`test('${title}', async () => {`, `  await run(['check']${budget === null ? '' : `, { budget: ${budget} }`});`, '});', ''];
const raised = (report: Report): string[] => report.findings.filter((f) => f.kind === 'threshold-lowered').map((f) => f.detail);

test('question 95: the suite guard, a time a test names rises when one call of it names a larger time, though the test names a larger one elsewhere', () => {
  const both = (first: string): string[] => ["test('test 4: two runs end in time', async () => {", `  await run(['check'], { budget: ${first} });`, "  await run(['check'], { budget: 'LIMITS_RULES_RUN_MS' });", '});', ''];
  assert.deepEqual(raised(budgetChange(both("'LIMITS_RUN_MS'"), both("'LIMITS_RUN_MS'"))), []);
  assert.deepEqual(raised(budgetChange(both("'LIMITS_RUN_MS'"), both("'LIMITS_LARGE_RUN_MS'"))), ['the test "test 4: two runs end in time" names a larger budget: 120000 ms -> 300000 ms, a time of tests/numbers.ts that a test or the harness picks']);
  assert.deepEqual(raised(budgetChange(both("'LIMITS_LARGE_RUN_MS'"), both("'LIMITS_RUN_MS'"))), []);
});

test('question 95: the suite guard, a test renamed with a larger time is a rise, and a new test or a rename with the same time is not', () => {
  const renamed = budgetChange(call("'LIMITS_RUN_MS'"), call("'LIMITS_LARGE_RUN_MS'", 'test 4: a large run ends in time, renamed'));
  assert.deepEqual(raised(renamed), ['the test "test 4: a large run ends in time, renamed" names a larger budget than any test this change removes from the file: 120000 ms -> 300000 ms, a time of tests/numbers.ts that a test or the harness picks']);
  assert.deepEqual(raised(budgetChange(call("'LIMITS_RUN_MS'"), call("'LIMITS_RUN_MS'", 'test 4: a large run ends in time, renamed'))), []);
  assert.deepEqual(raised(budgetChange(call("'LIMITS_RUN_MS'"), call("'LIMITS_RUN_MS'", 'test 4: a large run ends in time, renamed').concat(call("'LIMITS_RUN_MS'", 'test 5: another')))), []);
  assert.deepEqual(raised(budgetChange(call("'LIMITS_RUN_MS'"), [...call("'LIMITS_RUN_MS'"), ...call("'LIMITS_LARGE_RUN_MS'", 'test 6: a new test')])), []);
});

test('question 95: the suite guard, a call that drops its named time falls to the default and is a rise, and a call that drops a time past the default is not', () => {
  assert.deepEqual(raised(budgetChange(call("'LEFTOVER_GRACE_MS'"), call(null))), ['the test "test 4: a large run ends in time" names a larger budget: 2000 ms -> 20000 ms, a time of tests/numbers.ts that a test or the harness picks']);
  assert.deepEqual(raised(budgetChange(call("'LIMITS_RUN_MS'"), call(null))), []);
  assert.deepEqual(raised(budgetChange(call(null), call(null))), []);
});

test('question 95: the suite guard, a time named from parts of a string is read as the name they make', () => {
  assert.deepEqual(raised(budgetChange(call("'LIMITS_RUN_MS'"), call("'LIMITS_' + 'LARGE_RUN_MS'"))), ['the test "test 4: a large run ends in time" names a larger budget: 120000 ms -> 300000 ms, a time of tests/numbers.ts that a test or the harness picks']);
  assert.deepEqual(raised(budgetChange(call("'LIMITS_RUN_MS'"), call("`LIMITS_` + `LARGE_` + 'RUN_MS'"))), ['the test "test 4: a large run ends in time" names a larger budget: 120000 ms -> 300000 ms, a time of tests/numbers.ts that a test or the harness picks']);
  assert.deepEqual(raised(budgetChange(call("'LIMITS_LARGE_RUN_MS'"), call("'LIMITS_' + 'RUN_MS'"))), []);
});

const CODES = [
  '# Codes',
  '',
  '| Code | Kind | When | Why |',
  '|---|---|---|---|',
  '| `usage` | exit 2 | the command line breaks its usage line | the tool does only what its usage line says |',
  '| `no-git` | exit 2 | git cannot give the files | the files come from git |',
  '',
  '## Notes',
  '',
  '| Text | When | Fix |',
  '|---|---|---|',
  '| a note | always | none |',
  '',
  '```',
  '| Code | Kind |',
  '|---|---|',
  '| `in-a-fence` | exit 2 |',
  '```',
  '',
].join('\n');

const FIELDS = [
  '# JSON',
  '',
  '## one/0',
  '',
  '| Field | Value |',
  '|---|---|',
  '| `result` | pass or fail |',
  '| `path` | the path |',
  '| `path` | the path again |',
  '',
  '## two/0',
  '',
  '| Field | Value |',
  '|---|---|',
  '| `result` | the result of two |',
  '',
].join('\n');

function tablesChange(codes: string, fields: string, was = FIELDS): Report {
  const repo = baseRepo({ ...BASE, 'docs/codes.md': CODES, 'docs/json.md': was });
  try {
    writeFileSync(join(repo.dir, 'docs/codes.md'), codes);
    writeFileSync(join(repo.dir, 'docs/json.md'), fields);
    sh(repo.dir, ['commit', '-q', '--allow-empty', '-a', '-m', 'the tables change']);
    return judge(repo.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
  } finally {
    repo.done();
  }
}

const promises = (report: Report): string[] => report.findings.filter((f) => f.kind === 'promise-changed').map((f) => f.subject);

test('question 95: the suite guard, a changed or removed row of the code table of docs/codes.md or of a field table of docs/json.md is promise-changed, the owner\'s kind, and an added row is not', () => {
  assert.deepEqual(promises(tablesChange(CODES, FIELDS)), []);
  assert.deepEqual(promises(tablesChange(CODES.replace('| `no-git` | exit 2 | git cannot give the files | the files come from git |', '$&\n| `new-code` | exit 2 | a new one | because |'), FIELDS.replace('| `result` | pass or fail |', '| `result` | pass or fail |\n| `extra` | an added field |'))), []);
  const changed = tablesChange(CODES.replace('the command line breaks its usage line', 'the command line is wrong'), FIELDS);
  assert.deepEqual(promises(changed), ['docs/codes.md row usage under "Codes"']);
  const finding = changed.findings.find((f) => f.kind === 'promise-changed')!;
  assert.equal(finding.cleared, false);
  assert.equal(finding.needsBase, true);
  assert.match(finding.needs!, / \| owner \|$/);
  assert.deepEqual(promises(tablesChange(CODES.replace(/\| `no-git`.*\n/, ''), FIELDS)), ['docs/codes.md row no-git under "Codes"']);
  assert.deepEqual(promises(tablesChange(CODES, FIELDS.replace('| `result` | the result of two |', '| `result` | another result of two |'))), ['docs/json.md row result under "two/0"']);
  assert.deepEqual(promises(tablesChange(CODES, FIELDS.replace('the path again', 'the same path'))), ['docs/json.md row path under "one/0"']);
  assert.deepEqual(promises(tablesChange(CODES.replace('| a note | always | none |', '| a note | never | none |').replace('| `in-a-fence` | exit 2 |', '| `in-a-fence` | exit 1 |'), FIELDS)), ['docs/codes.md block 1 under "Notes"']);
});

test('question 95: the suite guard, the approval hash of a changed row covers the row as it is now', () => {
  const one = tablesChange(CODES.replace('the files come from git', 'git gives the files'), FIELDS);
  const two = tablesChange(CODES.replace('the files come from git', 'git gives the files and the change'), FIELDS);
  assert.notEqual(one.findings.find((f) => f.kind === 'promise-changed')!.approves, two.findings.find((f) => f.kind === 'promise-changed')!.approves);
});

const EXPLAIN = [
  '# JSON',
  '',
  '## explain/0',
  '',
  '| Field | Value |',
  '|---|---|',
  '| `path` | the path of a file |',
  '',
  'Between the tables.',
  '',
  '| Field | Value |',
  '|---|---|',
  '| `path` | the path of a node |',
  '',
  'Again.',
  '',
  '| Field | Value |',
  '|---|---|',
  '| `path` | the path of a type |',
  '',
].join('\n');

test('question 95: the suite guard, a table or a row added among rows with the same first cell and heading is no weakening, and a changed or removed one of them is', () => {
  const inserted = EXPLAIN.replace('Between the tables.', 'Between the tables.\n\n| Field | Value |\n|---|---|\n| `path` | a path that is new |');
  assert.deepEqual(promises(tablesChange(CODES, inserted, EXPLAIN)), []);
  const first = EXPLAIN.replace('Between the tables.', 'A table before the second.\n\n| Field | Value |\n|---|---|\n| `extra` | a field that is new |\n| `path` | a path that is new |\n\nBetween the tables.');
  assert.deepEqual(promises(tablesChange(CODES, first, EXPLAIN)), []);
  assert.deepEqual(promises(tablesChange(CODES, EXPLAIN.replace('the path of a node', 'the path of a symbol'), EXPLAIN)), ['docs/json.md row path under "explain/0"']);
  assert.deepEqual(promises(tablesChange(CODES, EXPLAIN.replace('| `path` | the path of a node |\n', ''), EXPLAIN)), ['docs/json.md row path under "explain/0"']);
});
