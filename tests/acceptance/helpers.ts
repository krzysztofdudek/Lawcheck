import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const CLI = join(ROOT, 'dist', 'cli.js');
export const SAMPLE = join(ROOT, 'tests', 'sample');

export const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};
delete GIT_ENV.LAWCHECK_BASE;

export const D = [
  'export function discount(net: number): number {',
  "  console.log('discount', net);",
  '  // TODO campaign codes',
  "  console.warn('no campaign'); // lawcheck-waive no-console -- the pricing team reads this warning until 2.0",
  '  return net;',
  '}',
  '',
].join('\n');

export const D_PATH = 'src/core/discount.ts';

export const TEST3 = [
  'lawcheck: FAIL  1 error, 1 warning in 1 changed file (against main), 1 waiver',
  '',
  'src/core/discount.ts:2  error[no-console]  writes to the terminal with console.log',
  '  why:  Only the command layer writes to the terminal.',
  'src/core/discount.ts:3  warning[no-todo]  TODO without an issue number',
  '  why:  A TODO without an issue number gets forgotten.',
  '',
  'debt (outside this change): 3 findings in 3 files',
  'src/core/price.ts:2  warning[no-console]  writes to the terminal with console.log',
  'src/core/tax.ts:1  warning[no-todo]  TODO without an issue number',
  'tools/release.mjs:2  warning[no-todo]  TODO without an issue number',
  '',
  'next: fix src/core/discount.ts:2',
  '',
].join('\n');

export const TEST4 = [
  'lawcheck: FAIL  1 error, 1 warning in 1 changed file (against main), 1 waiver',
  '',
  'src/core/discount.ts:2  error[no-console]  writes to the terminal with console.log',
  '  why:  Only the command layer writes to the terminal.',
  'src/core/discount.ts:3  warning[no-todo]  TODO without an issue number',
  '  why:  A TODO without an issue number gets forgotten.',
  '',
  'next: fix src/core/discount.ts:2',
  '',
].join('\n');

export const NOTHING_CHANGED = 'lawcheck: PASS  nothing changed against main\n';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export interface Temp {
  dir: string;
  remove(): void;
}

export function temp(): Temp {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-test-'));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function inTemp<T>(body: (dir: string) => Promise<T> | T): Promise<T> {
  const t = temp();
  try {
    return await body(t.dir);
  } finally {
    t.remove();
  }
}

export function copySample(target: string): void {
  mkdirSync(target, { recursive: true });
  cpSync(SAMPLE, target, { recursive: true });
}

export interface SampleOptions {
  onMain?: (s: string) => void;
  under?: string;
  top?: (repo: string) => void;
}

export function makeSample(dir: string, options: SampleOptions = {}): string {
  const repo = join(dir, 's');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  const at = options.under ? join(repo, options.under) : repo;
  copySample(at);
  options.top?.(repo);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'sample');
  if (options.onMain) {
    options.onMain(repo);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'second');
  }
  git(repo, 'checkout', '-q', '-b', 'work');
  return repo;
}

export async function withSample<T>(body: (s: string, dir: string) => Promise<T> | T, options: SampleOptions = {}): Promise<T> {
  return inTemp((dir) => body(makeSample(dir, options), dir));
}

export function write(repo: string, path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

export function append(repo: string, path: string, content: string): void {
  appendFileSync(join(repo, path), content);
}

export function read(repo: string, path: string): string {
  return readFileSync(join(repo, path), 'utf8');
}

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

export function lawcheck(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
  });
}

export function check(cwd: string, ...args: string[]): Promise<Run> {
  return lawcheck(cwd, ['check', ...(args.length > 0 ? args : ['--base', 'main'])]);
}

export function setRule(repo: string, rule: string, source: string): void {
  write(repo, `.lawcheck/rules/${rule}.mjs`, source);
}

export const NO_CONSOLE = readFileSync(join(SAMPLE, '.lawcheck/rules/no-console.mjs'), 'utf8');
export const NO_TODO = readFileSync(join(SAMPLE, '.lawcheck/rules/no-todo.mjs'), 'utf8');
export const LAW = readFileSync(join(SAMPLE, '.lawcheck/law.yaml'), 'utf8');

export function findingLines(stdout: string): string[] {
  return stdout.split('\n').filter((line) => /^\S+  (error|warning)\[[a-z0-9-]+\]  /.test(line));
}

export function lines(stdout: string): string[] {
  return stdout.split('\n');
}
