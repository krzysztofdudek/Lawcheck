import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { git, GIT_ENV, inTemp, lawcheck, read, ROOT, write } from './helpers.ts';

const ADVISORY = new Set(['errors-name-the-fix', 'docs-state-facts']);
const WAIVERS: { file: string; rule: string; reason: string }[] = [];
const UNRESOLVED = [{ file: 'scripts/grammars.ts', what: '..', answer: 'none', reason: 'unfollowed' }];
const UNSORTED = new Set(['args', 'check', 'cli', 'config', 'docs', 'doctor', 'environment', 'explain', 'files', 'glob', 'guard', 'init', 'keys', 'law', 'lawchange', 'limits', 'main', 'names', 'output', 'prime', 'programs', 'progress', 'prompt', 'readers', 'review', 'rules', 'setup', 'try', 'types', 'uses', 'verdicts', 'waivers', 'work'].map((name) => `src/${name}.ts`).concat(['src/bin.cts'], ['anthropic', 'claude-code', 'codex', 'copilot-cli', 'gemini-cli', 'google', 'http', 'index', 'ollama', 'openai', 'openai-compatible', 'program'].map((name) => `src/providers/${name}.ts`)));

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
  unresolved: { file: string; what: string; answer: string; reason: string | null }[];
}

function cloneOfHead(dir: string): string {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, env: GIT_ENV, stdio: 'ignore' });
  } catch {
    throw new Error('could not run: git cannot see the repository');
  }
  const repo = join(dir, 'clone');
  git(dir, 'clone', '-q', '--no-hardlinks', ROOT, repo);
  return repo;
}

function exempted(repo: string): string[] {
  const law = parse(read(repo, '.lawcheck/law.yaml')) as { types: { source: { paths: string[] } } };
  return law.types.source.paths
    .filter((pattern) => pattern.startsWith('!'))
    .flatMap((pattern) => {
      const list = /^!((?:[\w-]+\/)+)\{([^}]*)\}\.ts$/.exec(pattern);
      return list === null ? [pattern.slice(1)] : list[2]!.split(',').map((name) => `${list[1]}${name}.ts`);
    });
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

test('question 160: the committed tree has no finding of an enforced rule and none of a built-in code, and only the waivers and the unresolved use listed here', async () => {
  await inTemp(async (dir) => {
    const repo = cloneOfHead(dir);
    const { report, found } = await blocking(repo);
    assert.deepEqual(found, []);
    assert.deepEqual(report.waivers.map((w) => ({ file: w.file, rule: w.rule, reason: w.reason })), WAIVERS);
    assert.deepEqual(report.unresolved.map((u) => ({ file: u.file, what: u.what, answer: u.answer, reason: u.reason })), UNRESOLVED);
  });
});

test('question 160: the files of src that the law leaves without a type are only those it left out when it landed, so the list only shrinks', async () => {
  await inTemp(async (dir) => {
    const repo = cloneOfHead(dir);
    assert.deepEqual(exempted(repo).filter((name) => !UNSORTED.has(name)), []);
    const law = read(repo, '.lawcheck/law.yaml');
    assert.ok(law.includes('"!src/{args,'));
    assert.ok(law.includes('"!src/providers/{anthropic,'));
    assert.equal(law.split('}.ts"]').length, 2);
    write(repo, '.lawcheck/law.yaml', law.replace('"!src/{args,', '"!src/{args,law-set,').replace('{anthropic,', '{anthropic,sneak,').replace('}.ts"]', '}.ts", "!src/steps/**"]'));
    assert.deepEqual(exempted(repo).filter((name) => !UNSORTED.has(name)), ['src/law-set.ts', 'src/providers/sneak.ts', 'src/steps/**']);
  });
});

test('question 160: a committed break of each script rule and a forbidden use are found by the same check', async () => {
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

const LAYERING = [
  'lawcheck: 0.1.0',
  '',
  'types:',
  '  commands:',
  '    paths: ["src/{check,docs,doctor,explain,init,prime,try}.ts"]',
  '    may_use: [review, providers, rule-runs, provider-contract, rest]',
  '  review:',
  '    paths: ["src/review.ts"]',
  '    may_use: [rule-runs, provider-contract, rest]',
  '  providers:',
  '    paths: ["src/providers/**"]',
  '    may_use: [providers, provider-contract, rest]',
  '  rule-runs:',
  '    paths: ["src/rules.ts"]',
  '  provider-contract:',
  '    paths: ["src/provider.ts"]',
  '  rest:',
  '    paths: ["**", "!src/{check,docs,doctor,explain,init,prime,provider,review,rules,try}.ts", "!src/providers/**"]',
  '',
].join('\n');

test('R-5: no command imports another, the call loop of the reviewer takes the contract of a provider and no provider, and no provider uses the runs of script rules', async () => {
  await inTemp(async (dir) => {
    const repo = cloneOfHead(dir);
    rmSync(join(repo, '.lawcheck/rules'), { recursive: true, force: true });
    write(repo, '.lawcheck/law.yaml', LAYERING);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'the layers of R-5');
    const run = await lawcheck(repo, ['check', '--full', '--base', 'HEAD', '--json']);
    assert.equal(run.stderr, '');
    assert.equal(run.code, 0, run.stdout);
    const report = JSON.parse(run.stdout) as Report;
    const found = report.findings.filter((f) => f.code === 'forbidden-use').map((f) => `${f.file}:${f.line ?? ''} ${f.message}`).sort();
    assert.deepEqual(found, []);
  });
});

test('R-81: src/runner.ts has the type rule-runner, so the runner of script rules using a module of Lawcheck is a forbidden-use', async () => {
  await inTemp(async (dir) => {
    const repo = cloneOfHead(dir);
    write(repo, 'src/runner.ts', `import { count } from './limits.js';\n${read(repo, 'src/runner.ts')}`);
    git(repo, 'commit', '-q', '-a', '-m', 'the runner uses the limits');
    const { found } = await blocking(repo);
    assert.deepEqual(found.filter((line) => line.includes('[forbidden-use]')), ['src/runner.ts:1 warning[forbidden-use] rule-runner may not use src/limits.ts, which has no type; its may_use is []']);
  });
});
