import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCase, BASE, baseRepo, fixtureConfig, GIT_ENV, RATCHET, sh } from './fixture.ts';
import { judge, render, type Report } from './guard.ts';

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
  'refused-spec-example-by-reviewer': { refused: ['promise-changed'] },
  'refused-guard-by-reviewer': { refused: ['guard-changed'] },
  'refused-guard-config-by-reviewer': { refused: ['guard-changed'] },
  'refused-ci-workflow-by-reviewer': { refused: ['ci-changed'] },
  'refused-ci-scripts-by-reviewer': { refused: ['ci-changed'] },
  'refused-threshold-by-reviewer': { refused: ['threshold-lowered'] },
  'refused-threshold-no-record': { refused: ['threshold-lowered'] },
  'refused-threshold-seed-changed': { refused: ['threshold-lowered'] },
  'refused-threshold-removed': { refused: ['threshold-lowered'] },
  'refused-threshold-direction-turned': { refused: ['threshold-lowered'] },
  'refused-number-unreadable': { refused: ['number-unreadable'] },
  'refused-finding-removed': { refused: ['finding-weakened'] },
  'refused-finding-severity-lowered': { refused: ['finding-weakened'] },
  'refused-finding-reopened': { refused: ['finding-weakened'] },
  'refused-ratchet-grew': { refused: ['ratchet-grew'] },
  'refused-number-unclassified': { refused: ['number-unclassified'] },
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
  'refused-sabotage-changed': { refused: ['sabotage-changed'] },
  'refused-harness-no-record': { refused: ['harness-changed'] },
  'refused-docs-example-no-record': { refused: ['docs-example-changed'] },
  'accepted-expected-runes': { cleared: ['expected-changed'] },
  'accepted-expected-ruling': { cleared: ['expected-changed'] },
  'accepted-test-removed-ledger': { cleared: ['test-removed'] },
  'accepted-test-removed-with-row': { cleared: ['promise-changed', 'test-removed'] },
  'accepted-promise-by-owner': { cleared: ['promise-changed'] },
  'accepted-guard-by-owner': { cleared: ['guard-changed', 'guard-changed'] },
  'accepted-ci-by-owner': { cleared: ['ci-changed', 'ci-changed'] },
  'accepted-threshold-by-owner': { cleared: ['threshold-lowered'] },
  'accepted-threshold-stronger': { cleared: [] },
  'accepted-new-number-with-direction': { cleared: [] },
  'accepted-finding-state-changed': { cleared: [] },
  'accepted-finding-removed-ruling': { cleared: ['finding-weakened'] },
  'accepted-ratchet-shrinks': { cleared: [] },
  'accepted-slow-test-removed': { cleared: [] },
  'accepted-slow-test-added-ruling': { cleared: ['ratchet-grew'] },
  'accepted-ratchet-grew-ruling': { cleared: ['ratchet-grew'] },
  'accepted-skip-platform': { cleared: [] },
  'accepted-sabotage-removed': { cleared: ['promise-changed', 'sabotage-removed'] },
  'accepted-harness-by-reviewer': { cleared: ['harness-changed'] },
  'accepted-new-test': { cleared: [] },
  'accepted-test-moved': { cleared: [] },
  'accepted-docs-example-ruling': { cleared: ['docs-example-changed'] },
};

function judgeCase(name: string): Report {
  const repo = baseRepo();
  try {
    applyCase(repo, join(CASES, `${name}.diff`));
    return judge(repo.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
  } finally {
    repo.done();
  }
}

test('suite guard (T-7 A): every case on disk has an expectation, and every expectation a case', () => {
  const onDisk = readdirSync(CASES).filter((f) => f.endsWith('.diff')).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(onDisk, Object.keys(EXPECT).sort());
  assert.ok(onDisk.filter((n) => n.startsWith('refused-')).length >= 30);
});

for (const [name, expect] of Object.entries(EXPECT)) {
  test(`suite guard (T-7 A): ${name}`, () => {
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

test('suite guard (T-7 A): a refusal names the weakening, the record that would pass it, and the anchors that count', () => {
  const text = render(judgeCase('refused-test-removed'));
  assert.equal(text, [
    'REFUSED  test-removed  test 2: the passing run',
    'where    tests/acceptance/cli.test.ts:8',
    'what     removed or renamed',
    'why      no record of it in this change',
    'needs    a row added to tests/weakenings.md in this change:',
    '         | 2026-11-15 | test 2: the passing run | test-removed | <why the suite may get weaker here> | <anchor> | reviewer <the fresh reviewer agent> |',
    "anchor   the acceptance row ('row <n>'), invariant ('I-...') or ledger row ('S<r>-<n>') that the test's name names, removed or reworded in this change; or 'ruling <n>' of spec/questions.md; or 'Runes <version>' that this change moves to",
    '',
    text.trimEnd().split('\n').at(-1),
    '',
  ].join('\n'));
});

test('suite guard (T-7 A): an owner kind approved by a reviewer says who must approve it', () => {
  const report = judgeCase('refused-guard-by-reviewer');
  const finding = report.findings.find((f) => f.kind === 'guard-changed')!;
  assert.deepEqual(finding.why, ['the record at tests/weakenings.md:6: guard-changed needs the approval of owner, and reviewer approved it']);
});

test('suite guard (T-7 A): an anchor that does not exist, and one this change does not touch, are named as such', () => {
  const missing = judgeCase('refused-expected-anchor-missing').findings.find((f) => f.kind === 'expected-changed')!;
  assert.deepEqual(missing.why, ["the record at tests/weakenings.md:6: the anchor 'row 99' does not exist in the spec"]);
  const unchanged = judgeCase('refused-expected-anchor-unchanged').findings.find((f) => f.kind === 'expected-changed')!;
  assert.deepEqual(unchanged.why, ["the record at tests/weakenings.md:6: the anchor 'row 2' exists, but this change does not add, reword or remove it"]);
});

test('suite guard (T-7 A): who may approve each kind is configuration', () => {
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

test('suite guard (T-7 A): a number with no direction in tests/numbers.ts fails even when nothing else changed', () => {
  const repo = baseRepo({ ...BASE, 'tests/numbers.ts': BASE['tests/numbers.ts']!.replace("SEED: 'fixed', ", '') });
  try {
    applyCase(repo, join(CASES, 'accepted-new-test.diff'));
    const report = judge(repo.dir, 'main', 'work', fixtureConfig(), '2026-11-15');
    assert.deepEqual(report.findings.map((f) => [f.kind, f.subject, f.cleared]), [['number-unclassified', 'SEED', false]]);
  } finally {
    repo.done();
  }
});

function guardRepo(headGuardPatch: (text: string) => string): { dir: string; done: () => void } {
  const own: { [path: string]: string } = {};
  for (const file of readdirSync(HERE)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    own[`tests/guard/${file}`] = readFileSync(join(HERE, file), 'utf8');
  }
  own['tests/guard/config.json'] = `${JSON.stringify({ ...JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8')), ratchets: [RATCHET] }, null, 2)}\n`;
  const files = { ...BASE, ...own };
  delete files['tests/guard/check.ts'];
  const repo = baseRepo(files);
  applyCase(repo, join(CASES, 'refused-expected-no-record.diff'));
  const guardFile = join(repo.dir, 'tests/guard/guard.ts');
  writeFileSync(guardFile, headGuardPatch(readFileSync(guardFile, 'utf8')));
  sh(repo.dir, ['commit', '-q', '-a', '-m', 'the branch edits its judge']);
  return { dir: repo.dir, done: repo.done };
}

test('suite guard (T-7 A): the judge is the guard of the base, so a branch that edits its own guard is still refused', () => {
  const repo = guardRepo((text) => text.replace('passed: findings.every((f) => f.cleared)', 'passed: true'));
  try {
    const head = spawnSync(process.execPath, ['tests/guard/cli.ts', '--base', 'main', '--head', 'work'], { cwd: repo.dir, env: GIT_ENV, encoding: 'utf8' });
    assert.equal(head.status, 0, 'the branch\'s own guard lets itself pass');
    const run = spawnSync(process.execPath, [join(HERE, 'from-base.ts'), '--repo', repo.dir, '--base', 'main', '--head', 'work'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.equal(run.stderr, '');
    assert.ok(run.stdout.includes('REFUSED  expected-changed  tests/real/hono.expected'), run.stdout);
    assert.ok(run.stdout.includes('REFUSED  guard-changed  tests/guard/guard.ts'), run.stdout);
    assert.match(run.stdout.trimEnd().split('\n').at(-1)!, /^suite guard: FAIL {2}2 weakenings without a valid record \(/);
  } finally {
    repo.done();
  }
});

test('suite guard (T-7 A): with no guard on the base, the entry point says so and passes', () => {
  const repo = baseRepo();
  try {
    applyCase(repo, join(CASES, 'refused-expected-no-record.diff'));
    const run = spawnSync(process.execPath, [join(HERE, 'from-base.ts'), '--repo', repo.dir, '--base', 'main', '--head', 'work'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(run.stderr, '');
    assert.equal(run.status, 0);
    assert.match(run.stdout, /^suite guard: PASS {2}the base [0-9a-f]{7} has no suite guard yet: nothing judges this change\n$/);
    const zero = spawnSync(process.execPath, [join(HERE, 'from-base.ts'), '--repo', repo.dir, '--base', '0000000000000000000000000000000000000000', '--head', 'work'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(zero.status, 0);
    assert.equal(zero.stdout, 'suite guard: PASS  no base commit (0000000000000000000000000000000000000000): nothing judges this push\n');
  } finally {
    repo.done();
  }
});

test('suite guard (T-7 A): the command exits 2 with a reason when it cannot judge', () => {
  const repo = baseRepo();
  try {
    const run = spawnSync(process.execPath, [join(HERE, 'cli.ts'), '--repo', repo.dir, '--base', 'nope'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, `suite guard: could not run: the base 'nope' is not a commit in ${repo.dir}\n`);
    const usage = spawnSync(process.execPath, [join(HERE, 'cli.ts'), '--bogus'], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(usage.status, 2);
    assert.equal(usage.stderr, "suite guard: unknown argument '--bogus'\nusage: node tests/guard/cli.ts [--repo <dir>] [--base <rev>] [--head <rev>] [--json]\n");
  } finally {
    repo.done();
  }
});
