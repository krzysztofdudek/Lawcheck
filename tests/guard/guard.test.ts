import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  'refused-number-unreadable': { refused: ['number-unreadable'] },
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
  'accepted-test-moved': { cleared: [] },
  'accepted-docs-example-ruling': { cleared: ['docs-example-changed'] },
};

function caseBase(name: string): { [path: string]: string } {
  const rows = join(CASES, `${name}.base.md`);
  return existsSync(rows) ? { ...BASE, 'tests/weakenings.md': BASE['tests/weakenings.md'] + readFileSync(rows, 'utf8') } : BASE;
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
    "anchor   the test number ('test <n>'), promise ('I-...') or finding ('S<r>-<n>') that the test's name leads with; or 'ruling <n>' of design/decisions.md; or 'Runes <version>' that this change moves to",
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
  assert.deepEqual(missing.why, ["the record at tests/weakenings.md:6: the anchor 'row 99' does not exist in the names of the tests"]);
  const unchanged = judgeCase('refused-expected-anchor-unchanged').findings.find((f) => f.kind === 'expected-changed')!;
  assert.deepEqual(unchanged.why, ["the record at tests/weakenings.md:6: the anchor 'row 2' exists, but this change does not add, reword or remove it"]);
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
