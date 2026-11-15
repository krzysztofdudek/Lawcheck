import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Config } from './guard.ts';
import { loadConfig } from './guard.ts';

export const BASE: { [path: string]: string } = {
  'package.json': `${JSON.stringify({
    name: 'fixture',
    type: 'module',
    scripts: { build: 'tsc -p .', test: 'npm run build && node --test "tests/**/*.test.ts"' },
    dependencies: { '@chrisdudek/runes': '1.1.0' },
  }, null, 2)}\n`,
  'spec/check-slice.md': [
    '# Check slice',
    '',
    '## 6. Output',
    '',
    'The passing run prints:',
    '',
    '<!-- example: pass-run -->',
    '```',
    'lawcheck: PASS  nothing changed against main',
    '```',
    '',
    '## 8. Acceptance',
    '',
    '| # | Do | See |',
    '|---|---|---|',
    '| 1 | nothing | `lawcheck: PASS  nothing changed against main`, exit 0 |',
    '| 2 | the passing run of section 6 | its output, exit 0 |',
    '| 3 | add 60 findings | 50 finding lines, then `... 10 more findings` |',
    '',
    '## 9. Invariants',
    '',
    '| Id | Promise | Test |',
    '|---|---|---|',
    '| I-frame-1 | No text of a judged file starts a line of the prompt without its line number. | tests/acceptance/cli.test.ts |',
    '| I-out-1 | No output line starts with a CI command. | tests/acceptance/cli.test.ts |',
    '',
  ].join('\n'),
  'spec/questions.md': [
    '# Questions',
    '',
    '## 1. Two waivers covering one finding',
    '',
    'Choice: the waiver on the finding\'s own line takes the finding.',
    '',
  ].join('\n'),
  'docs/ci.md': [
    '# Lawcheck in CI',
    '',
    '## The workflow',
    '',
    '```yaml',
    'run: npx lawcheck check --base origin/main',
    '```',
    '',
  ].join('\n'),
  'tests/findings.md': [
    '# Findings',
    '',
    '| Id | Severity | Class | State | Test |',
    '|---|---|---|---|---|',
    '| S1-1 | should be fixed before | hostile input | open | |',
    '| S2-1 | after the release | limit | closed | |',
    '| S3-1 | blocks the release | security | open | S3-1: a lone CR does not start a prompt line |',
    '',
  ].join('\n'),
  'tests/numbers.ts': [
    'export const SEED = 20261115;',
    'export const PROPERTY_CASES = 100;',
    'export const BUDGET = { cli: 20_000, hook: 5000 } as const;',
    "export const SLOW_TESTS: Record<string, number> = { 'test 24': 60_000 };",
    'export const SECTION_ONLY_TESTS = 218;',
    "export const SPEED = ((): string => process.env.LAWCHECK_SPEED ?? 'commit')();",
    "export const stronger: Record<string, 'higher' | 'lower' | 'fixed'> = { SEED: 'fixed', PROPERTY_CASES: 'higher', BUDGET: 'lower', SLOW_TESTS: 'lower', SECTION_ONLY_TESTS: 'lower' };",
    '',
  ].join('\n'),
  'tests/harness/skips.ts': [
    "export const PLATFORM_SKIPS: PlatformSkip[] = [",
    "  { test: 'S3-1', part: 'the whole test', platform: 'win32', reason: 'no file mode on Windows' },",
    "  { test: 'test 1', part: 'an unreadable file', platform: 'root', reason: 'chmod cannot make a file unreadable for root' },",
    '];',
    '',
    'export function platformSkip(part: string): string | null {',
    '  return part ? null : null;',
    '}',
    '',
  ].join('\n'),
  'tests/harness/sets.ts': [
    "export const PLATFORM_TESTS: PlatformTest[] = [",
    "  { file: 'tests/acceptance/cli.test.ts', test: 'test 1: nothing changed', systems: ['win32', 'darwin'], reason: 'paths' },",
    "  { file: 'tests/acceptance/cli.test.ts', test: 'I-frame-1: no text of a file starts a prompt line', systems: ['win32'], reason: 'line endings' },",
    '];',
    '',
  ].join('\n'),
  'tests/harness/promises.ts': [
    'export const PLATFORM_PROMISES: Record<string, { systems: string[]; behaviour: string }> = {',
    "  'test 1': { systems: ['win32'], behaviour: 'a path with backslashes' },",
    "  'I-frame-1': { systems: ['win32'], behaviour: 'CRLF line endings' },",
    '};',
    '',
  ].join('\n'),
  'tests/harness/schemas/check.json': '{ "type": "object", "required": ["schema"] }\n',
  'tests/acceptance/cli.test.ts': [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    '',
    "test('test 1: nothing changed', () => {",
    "  assert.equal(1, 1);",
    '});',
    '',
    "test('test 2: the passing run', () => {",
    "  assert.equal('PASS', 'PASS');",
    '});',
    '',
    "test('I-frame-1: no text of a file starts a prompt line', () => {",
    "  assert.ok(true);",
    '});',
    '',
    "test('S3-1: a lone CR does not start a prompt line', (t) => {",
    "  if (process.platform === 'win32') return t.skip('no file mode on Windows');",
    "  assert.equal(2, 2);",
    '});',
    '',
  ].join('\n'),
  'tests/real/hono.expected': 'src/index.ts  ok\nsrc/router.ts  ok\n',
  'tests/sabotage/list.json': `${JSON.stringify([
    { id: 'limit-50', promise: 'row 3', file: 'src/output.ts', find: 'const limit = 50;', replace: 'const limit = 51;', killedBy: 'test 3: at most 50 finding lines' },
    { id: 'frame-cr', promise: 'I-frame-1', file: 'src/types.ts', find: 'split(/\\r\\n|\\r|\\n/)', replace: 'split(/\\n/)', killedBy: 'I-frame-1: no text of a file starts a prompt line' },
  ], null, 2)}\n`,
  'src/output.ts': 'export function lines(all: string[]): string[] {\n  const limit = 50;\n  return all.slice(0, limit);\n}\n',
  'src/types.ts': "export function split(text: string): string[] {\n  return text.split(/\\r\\n|\\r|\\n/);\n}\n",
  'tests/guard/check.ts': 'export const GUARD = true;\n',
  'tests/guard/config.json': '{ "ratchets": [] }\n',
  'tests/run.ts': 'export {};\n',
  '.lawcheck/law.yaml': 'lawcheck: 1.0.0\nrules: {}\n',
  'tests/acceptance/self-law.test.ts': [
    "import { test } from 'node:test';",
    "const WAIVERS: { file: string; rule: string; reason: string }[] = [{ file: 'src/a.ts', rule: 'no-console', reason: 'the command layer' }];",
    "const UNSORTED = new Set(['args', 'check'].map((name) => `src/${name}.ts`));",
    "test('question 1: the tree has only the waivers listed here', () => {});",
    '',
  ].join('\n'),
  'tests/contract/pending.json': '[\n  { "id": "rule-crashed", "finding": "S2-2" }\n]\n',
  '.github/workflows/ci.yml': 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n',
  'tests/weakenings.md': [
    '# Weakenings of the suite',
    '',
    '| Date | What | Kind | Reason | Anchor | Approved by |',
    '|---|---|---|---|---|---|',
    '| 2026-11-01 | tests/real/hono.expected | expected-changed | Runes 1.1.0 reads the router | Runes 1.1.0 | reviewer old-agent |',
    '',
  ].join('\n'),
};

export const RATCHET = 'tests/contract/pending.json';

export function fixtureConfig(): Config {
  return { ...loadConfig(), ratchets: [RATCHET, { file: 'tests/harness/skips.ts', lists: ['PLATFORM_SKIPS'] }, { file: 'tests/acceptance/self-law.test.ts', lists: ['WAIVERS', 'UNSORTED'] }] };
}

export const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  LC_ALL: 'C',
};
if (process.env.SYSTEMROOT) GIT_ENV.SYSTEMROOT = process.env.SYSTEMROOT;

export function sh(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
}

export type Repo = { dir: string; root: string; done: () => void };

export function baseRepo(files: { [path: string]: string } = BASE): Repo {
  const root = mkdtempSync(join(tmpdir(), 'lawcheck-guard-test-'));
  const dir = join(root, 'repo');
  mkdirSync(dir);
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['config', 'core.autocrlf', 'false']);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'base']);
  sh(dir, ['checkout', '-q', '-b', 'work']);
  return { dir, root, done: () => rmSync(root, { recursive: true, force: true }) };
}

export function applyCase(repo: Repo, diffPath: string): void {
  const diff = readFileSync(diffPath, 'utf8');
  sh(repo.dir, ['apply', '--recount', '--whitespace=nowarn', '-'], diff);
  sh(repo.dir, ['add', '-A']);
  sh(repo.dir, ['commit', '-q', '--allow-empty', '-m', 'case']);
}
