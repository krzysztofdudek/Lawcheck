import { test } from 'node:test';
import { example } from '../harness/examples.ts';
import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { append, check, findingLines, git, inTemp, LANGUAGES_SAMPLE, lawcheck } from './helpers.ts';

const FINDINGS = example('dependency-l-findings').split('\n');

const UNRESOLVED = example('dependency-l-unresolved').split('\n');

function unresolvedLine(u: any): string {
  const answer = u.reason === null ? u.answer : `${u.answer} ${u.reason}`;
  return `${u.file}:${u.line}  ${answer}  ${u.what}${u.candidates.length === 0 ? '' : `  [${u.candidates.join(', ')}]`}`;
}

function makeL(dir: string): string {
  const repo = join(dir, 'l');
  cpSync(LANGUAGES_SAMPLE, repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'l');
  return repo;
}

function place(finding: { file: string; line?: number }): string {
  return finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
}

test('test 88: one use from domain to app in each language', async () => {
  await inTemp(async (dir) => {
    const l = makeL(dir);
    const run = await lawcheck(l, ['check', '--json']);
    const document = JSON.parse(run.stdout);
    assert.deepEqual(document.scope, { mode: 'change', base: null, files: 36, law_changed: false });
    assert.deepEqual(document.summary, { errors: 15, warnings: 1, debt: 0, waivers: 0, unresolved: 9 });
    assert.deepEqual(
      document.findings.map((f: any) => `${place(f)}  ${f.severity}[${f.code}]  ${f.message}`),
      FINDINGS,
    );
    assert.ok(document.findings.every((f: any) => f.rule === null && f.debt === false), run.stdout);
    assert.deepEqual(
      document.unresolved.map(unresolvedLine),
      UNRESOLVED,
    );
    assert.ok(document.unresolved.every((u: any) => u.debt === false), run.stdout);
    assert.equal(run.code, 1);

    const text = await lawcheck(l, ['check']);
    assert.equal(text.stdout.split('\n')[0], 'lawcheck: FAIL  15 errors, 1 warning in 36 files (no base: every file counts as changed), 9 unresolved uses');
    assert.deepEqual(findingLines(text.stdout), FINDINGS);

    git(l, 'checkout', '-q', '-b', 'work');
    append(l, 'kotlin/src/main/kotlin/com/acme/k/domain/Order.kt', '// end\n');
    append(l, 'cs/domain/Order.cs', '// end\n');
    append(l, 'ruby/domain/order.rb', '# end\n');
    const changed = await check(l);
    assert.equal(changed.stdout.split('\n')[0], 'lawcheck: FAIL  4 errors in 3 changed files (against main), 1 unresolved use');
    assert.deepEqual(
      findingLines(changed.stdout),
      FINDINGS.filter((line) => /^(cs\/domain\/Order\.cs:5|kotlin\/src\/main\/kotlin\/com\/acme\/k\/domain\/Order\.kt:3|ruby\/domain\/order\.rb:[16])  /.test(line)),
    );
    assert.equal(findingLines(changed.stdout).length, 4);
    assert.equal(changed.code, 1);
  });
});

test('test 88, debt: every finding and unresolved use of L outside the change', async () => {
  await inTemp(async (dir) => {
    const l = makeL(dir);
    git(l, 'checkout', '-q', '-b', 'work');
    const run = await check(l, '--full', '--base', 'main');
    const lines = run.stdout.split('\n');
    assert.equal(lines[0], 'lawcheck: PASS  nothing changed against main');
    assert.ok(lines.includes('debt (outside this change): 16 findings in 15 files, 9 unresolved uses'), run.stdout);
    assert.deepEqual(findingLines(run.stdout), FINDINGS.map((line) => line.replace('  error[', '  warning[')));
    assert.equal(run.code, 0);
    const json = await check(l, '--full', '--base', 'main', '--json');
    const document = JSON.parse(json.stdout);
    assert.equal(document.summary.unresolved, 0);
    assert.equal(document.summary.debt, 16);
    assert.ok(document.findings.some((f: any) => f.code === 'uses-not-read' && f.debt === true), json.stdout);
    assert.deepEqual(document.unresolved.map(unresolvedLine), UNRESOLVED);
    assert.ok(document.unresolved.every((u: any) => u.debt === true), json.stdout);
    assert.equal(json.code, 0);
  });
});
