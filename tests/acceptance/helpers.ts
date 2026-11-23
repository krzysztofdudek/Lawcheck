import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { example, exampleText } from '../harness/examples.ts';
import { CLI, ROOT, startTool, testFolder } from '../harness/tool.ts';
import type { Expect, Run, Running, ToolOptions } from '../harness/tool.ts';

export { CLI, ROOT } from '../harness/tool.ts';
export type { Expect, Run, Running } from '../harness/tool.ts';
export const SAMPLE = join(ROOT, 'tests', 'sample');

// A copy of process.env keeps the spelling Path on Windows; one PATH key lets a test put its own folders first.
const OWN_ENV: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(OWN_ENV)) if (key !== 'PATH' && key.toUpperCase() === 'PATH') delete OWN_ENV[key];
OWN_ENV.PATH = process.env.PATH;

export const GIT_ENV: NodeJS.ProcessEnv = {
  ...OWN_ENV,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  // A commit, a merge or a rebase starts git's automatic maintenance in the background, and its repack writes .git/info/refs and packed-refs while the next run is compared (harness-7); a clone of a checkout with two packs or many loose objects starts it on every commit.
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'maintenance.auto',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'gc.auto',
  GIT_CONFIG_VALUE_1: '0',
};
delete GIT_ENV.LAWCHECK_BASE;
// CI services set CI or a variable of their own, and a plain check with no base refuses to run there (decision 87 of design/decisions.md); a test that wants CI sets one.
for (const name of ['GITHUB_BASE_REF', 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', 'CI_COMMIT_BEFORE_SHA', 'SYSTEM_PULLREQUEST_TARGETBRANCH', 'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'JENKINS_URL', 'BUILDKITE', 'CIRCLECI', 'TRAVIS', 'BITBUCKET_BUILD_NUMBER', 'TEAMCITY_VERSION', 'APPVEYOR', 'DRONE', 'CODEBUILD_BUILD_ID', 'BUILD_ID', 'WOODPECKER']) delete GIT_ENV[name];
for (const name of ['LAWCHECK_REVIEWER_ENDPOINT', 'LAWCHECK_REVIEWER_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'LAWCHECK_STABILITY_MODEL', 'LAWCHECK_STABILITY_OUT', 'LAWCHECK_STABILITY_RUNS']) {
  delete GIT_ENV[name];
}

export const D = exampleText('check-d');

export const D_PATH = 'src/core/discount.ts';

export const TEST3 = exampleText('check-failing-run');

export const TEST4 = TEST3.replace(/\ndebt \(outside this change\):[^]*?\n\n/, '\n');

export const NOTHING_CHANGED = 'lawcheck: PASS  nothing changed against main\n';

// /proc tells a zombie from a live process; elsewhere the system is asked whether the process exists.
export function alive(pid: number): boolean {
  if (existsSync('/proc/self/stat')) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function pathWith(...dirs: string[]): string {
  return [...dirs, GIT_ENV.PATH ?? ''].join(delimiter);
}

export function programDir(program: string): string {
  const found =
    process.platform === 'win32'
      ? execFileSync('where.exe', [program], { encoding: 'utf8' }).split(/\r?\n/)[0]!
      : execFileSync('sh', ['-c', `command -v ${program}`], { encoding: 'utf8' });
  return dirname(found.trim());
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export interface Temp {
  dir: string;
  remove(): void;
}

export function temp(): Temp {
  return testFolder();
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

export function lawcheck(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}, nodeArgs: string[] = [], expect: Expect = {}): Promise<Run> {
  return startTool(cwd, args, GIT_ENV, { ...expect, env, node: nodeArgs }).ended;
}

export function startLawcheck(cwd: string, args: string[], options: ToolOptions = {}): Running {
  return startTool(cwd, args, GIT_ENV, options);
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
  return stdout.split('\n').filter((line) => /^\S.*?  (error|warning)\[[a-z0-9-]+\]  /.test(line));
}

export function lines(stdout: string): string[] {
  return stdout.split('\n');
}

export const REVIEWER_SAMPLE = join(ROOT, 'tests', 'reviewer-sample');

export const F_PATH = 'src/core/refund.ts';

export const F = exampleText('reviewer-f');

export const F_PRIME = F.replace(
  "  if (!paid) throw new Error('failed');",
  "  if (!paid) throw new Error('The order is not paid yet; take the payment before a refund.');",
);

export const KEY_F = 'bec7eb69fcc74507cad562d7d51f13eb';
export const KEY_F_PRIME = '416ae89429881606bc1ead8e5e1f0e8b';
export const KEY_PRICE = '04359891722bcd49bac46a26fbb25f2a';
export const KEY_TAX = '3a171a910b49c962ed47f9b9795cfc97';

export const REVIEWER_LAW = readFileSync(join(REVIEWER_SAMPLE, '.lawcheck/law.yaml'), 'utf8');
export const REVIEWER_CONFIG = readFileSync(join(REVIEWER_SAMPLE, '.lawcheck/config.yaml'), 'utf8');

export function makeR(dir: string, options: SampleOptions = {}): string {
  return makeSample(dir, {
    ...options,
    top: (repo) => {
      cpSync(REVIEWER_SAMPLE, options.under ? join(repo, options.under) : repo, { recursive: true });
      options.top?.(repo);
    },
  });
}

export async function withR<T>(body: (r: string, dir: string) => Promise<T> | T, options: SampleOptions = {}): Promise<T> {
  return inTemp((dir) => body(makeR(dir, options), dir));
}

export const FRAME = example('reviewer-frame');

export const PROMPT_F = FRAME + '\n\n' + example('reviewer-prompt-f');

export const FIRST = exampleText('reviewer-first');

export const SECOND = exampleText('reviewer-second');

export const THIRD = exampleText('reviewer-third');

export function run(cwd: string, fake: { url: string } | null, args: string[], env: NodeJS.ProcessEnv = {}, expect: Expect = {}) {
  return lawcheck(cwd, ['check', ...args], { ...(fake ? { LAWCHECK_REVIEWER_ENDPOINT: fake.url } : {}), ...env }, [], expect);
}


export const USES_SAMPLE = join(ROOT, 'tests', 'uses-sample');
export const LANGUAGES_SAMPLE = join(ROOT, 'tests', 'languages-sample');
export const U_LAW = readFileSync(join(USES_SAMPLE, '.lawcheck/law.yaml'), 'utf8');

export const E_PATH = 'src/core/report.ts';

export const E = exampleText('dependency-e');

export function makeU(dir: string, options: SampleOptions = {}): string {
  return makeSample(dir, {
    ...options,
    top: (repo) => {
      cpSync(USES_SAMPLE, repo, { recursive: true });
      options.top?.(repo);
    },
  });
}

export async function withU<T>(body: (u: string, dir: string) => Promise<T> | T, options: SampleOptions = {}): Promise<T> {
  return inTemp((dir) => body(makeU(dir, options), dir));
}

export interface Copy {
  dir: string;
  cli: string;
  remove(): void;
}

export function makeCopy(): Copy {
  const { dir, remove } = testFolder('lawcheck-copy-');
  cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  cpSync(join(ROOT, 'dist'), join(dir, 'dist'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return { dir, cli: join(dir, 'dist', 'cli.js'), remove };
}

export async function withCopy<T>(body: (copy: Copy) => Promise<T> | T): Promise<T> {
  const copy = makeCopy();
  try {
    return await body(copy);
  } finally {
    copy.remove();
  }
}

export function lawcheckAt(cli: string, cwd: string, args: string[], env: NodeJS.ProcessEnv = {}, expect: Expect = {}): Promise<Run> {
  return startTool(cwd, args, GIT_ENV, { ...expect, env, cli }).ended;
}

export function newRepository(dir: string, files: Record<string, string> = {}): string {
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, 'README.md', '# Repo\n');
  for (const [path, content] of Object.entries(files)) write(repo, path, content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
  return repo;
}

export const PRICING = (law: string) => law.replace('        paths: ["src/cli/**"]\n', '        paths: ["src/cli/**"]\n      pricing:\n        paths: ["src/core/p*.ts"]\n');
