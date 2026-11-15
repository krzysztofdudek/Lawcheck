import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { git, GIT_ENV, inTemp, lawcheck, ROOT, write } from './helpers.ts';

const ADVISORY = new Set(['errors-name-the-fix', 'docs-state-facts']);
const WAIVERS: { file: string; rule: string; reason: string }[] = [];

interface Finding {
  code: string;
  rule: string | null;
  severity: string;
  file: string;
  line?: number;
  message: string;
}

interface Report {
  result: string;
  scope: { mode: string };
  findings: Finding[];
  waivers: { file: string; rule: string; reason: string }[];
}

function cloneOfHead(dir: string): string {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, env: GIT_ENV, stdio: 'ignore' });
  } catch {
    throw new Error('could not run: git cannot see the repository');
  }
  const repo = join(dir, 'lawcheck');
  git(dir, 'clone', '-q', '--no-hardlinks', ROOT, repo);
  return repo;
}

async function blocking(repo: string): Promise<{ report: Report; found: string[] }> {
  const run = await lawcheck(repo, ['check', '--full', '--base', 'HEAD', '--json']);
  assert.equal(run.stderr, '');
  assert.equal(run.code, 0, run.stdout);
  const report = JSON.parse(run.stdout) as Report;
  assert.equal(report.result, 'pass');
  assert.equal(report.scope.mode, 'full');
  const found = report.findings
    .filter((f) => f.rule === null || !ADVISORY.has(f.rule))
    .map((f) => `${f.file}:${f.line ?? ''} ${f.severity}[${f.code}] ${f.message}`)
    .sort();
  return { report, found };
}

test('ruling dogfood-fable: the committed tree has no finding of an enforced rule and none of a built-in code, and only the waivers listed here', async () => {
  await inTemp(async (dir) => {
    const repo = cloneOfHead(dir);
    const { report, found } = await blocking(repo);
    assert.deepEqual(found, []);
    assert.deepEqual(report.waivers.map((w) => ({ file: w.file, rule: w.rule, reason: w.reason })), WAIVERS);
  });
});

test('ruling dogfood-fable: a committed break of each script rule and a forbidden use are found by the same check', async () => {
  await inTemp(async (dir) => {
    const repo = cloneOfHead(dir);
    write(repo, 'src/core/break.ts', ["import { readFileSync } from 'node:fs';", "import { step } from '../steps/break.js';", 'export const now = (): number => Date.now() + step() + readFileSync.length;', ''].join('\n'));
    write(repo, 'src/steps/break.ts', ["import { other } from './cycle.js';", 'export let count = other;', 'export const step = (): number => Number(process.env.N);', 'export const here = (): string => import.meta.url;', ''].join('\n'));
    write(repo, 'src/steps/cycle.ts', ["import { count } from './break.js';", 'export const other = (): number => count;', ''].join('\n'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'break');
    const { found } = await blocking(repo);
    const review = 'comments-say-why has no verdict for this content';
    const word = 'next-keeps-the-users-word has no verdict for this content';
    assert.deepEqual(found, [
      'src/core/break.ts: warning[not-reviewed] ' + review,
      "src/core/break.ts:1 warning[layer-imports] imports node:fs, which core may not; it may import from outside: yaml, node:crypto",
      'src/core/break.ts:2 warning[forbidden-use] core may not use steps (src/steps/break.ts); its may_use is [core]',
      'src/core/break.ts:3 warning[pure-layers] reads the clock; a core module takes what it needs as an argument',
      'src/steps/break.ts: warning[not-reviewed] ' + review,
      'src/steps/break.ts: warning[not-reviewed] ' + word,
      'src/steps/break.ts:1 warning[no-import-cycles] imports src/steps/cycle.ts, which imports this file back; move what both need into a module that imports neither',
      'src/steps/break.ts:2 warning[modules-only-declare] keeps the variable count between calls; pass the state in, or hold it in an object the caller creates',
      'src/steps/break.ts:3 warning[programs-own-the-process] uses process.env outside the programs; take it from the context the program passes',
      "src/steps/break.ts:4 warning[own-paths-in-one-place] reads import.meta; src/adapters/package.ts computes every path into Lawcheck's own folder, so ask it",
      'src/steps/cycle.ts: warning[not-reviewed] ' + review,
      'src/steps/cycle.ts: warning[not-reviewed] ' + word,
      'src/steps/cycle.ts:1 warning[no-import-cycles] imports src/steps/break.ts, which imports this file back; move what both need into a module that imports neither',
    ].sort());
  });
});
