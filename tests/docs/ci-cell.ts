import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { example } from '../harness/examples.ts';

export const KINDS = ['npm-lock', 'npm-nolock', 'pnpm', 'yarn1'] as const;
export type Kind = (typeof KINDS)[number];

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SAMPLE = join(ROOT, 'tests', 'sample');
const ZEROS = '0'.repeat(40);
const GIT_IDENTITY = { GIT_AUTHOR_NAME: 'cell', GIT_AUTHOR_EMAIL: 'cell@example.com', GIT_COMMITTER_NAME: 'cell', GIT_COMMITTER_EMAIL: 'cell@example.com' };

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  name?: string;
  env?: Record<string, string>;
}

function bash(cwd: string, script: string, env: NodeJS.ProcessEnv): Result {
  const file = join(mkdtempSync(join(tmpdir(), 'lawcheck-step-')), 'step.sh');
  writeFileSync(file, script);
  const run = spawnSync('bash', ['-e', file], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  rmSync(join(file, '..'), { recursive: true, force: true });
  if (run.error) throw run.error;
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  const run = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} in ${cwd}: ${run.stderr}`);
  return run.stdout.trim();
}

function steps(): Step[] {
  const workflow = parse(example('ci-workflow')) as { jobs: { check: { steps: Step[] } } };
  return workflow.jobs.check.steps;
}

function expand(text: string, context: Record<string, string>): string {
  return text.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_, expression: string) => {
    if (!(expression in context)) throw new Error(`the test cannot evaluate \${{ ${expression} }}`);
    return context[expression]!;
  });
}

export interface Event {
  name: 'pull_request' | 'push' | 'merge_group';
  baseRef?: string;
  before?: string;
  mergeBase?: string;
}

interface Checkout {
  dir: string;
  ref: string;
}

export interface Cell {
  dir: string;
  home: string;
  env: NodeJS.ProcessEnv;
  tarball: string;
  kind: Kind;
  template: string;
  count: number;
}

function baseEnv(cell: { home: string }): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: cell.home,
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    LANG: 'C.UTF-8',
    npm_config_update_notifier: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    ...GIT_IDENTITY,
  };
}

function manager(kind: Kind, cwd: string, env: NodeJS.ProcessEnv, script: string): void {
  const run = bash(cwd, script, env);
  if (run.code !== 0) throw new Error(`${script} failed (${run.code}): ${run.stdout}${run.stderr}`);
}

export function makeCell(kind: Kind, tarball: string): Cell {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-ci-cell-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  mkdirSync(join(dir, 'tgz'));
  const kept = join(dir, 'tgz', 'lawcheck.tgz');
  cpSync(tarball, kept);
  const env = baseEnv({ home });
  const project = join(dir, 'p', 'template');
  mkdirSync(project, { recursive: true });
  cpSync(SAMPLE, project, { recursive: true });
  writeFileSync(join(project, 'package.json'), '{"name":"proj","version":"1.0.0","private":true}\n');
  writeFileSync(join(project, '.gitignore'), 'node_modules/\n');
  const dep = '../../tgz/lawcheck.tgz';
  if (kind === 'npm-lock') manager(kind, project, env, `npm install --save-dev file:${dep}`);
  if (kind === 'npm-nolock') {
    writeFileSync(join(project, '.npmrc'), 'package-lock=false\n');
    writeFileSync(join(project, 'package.json'), `{"name":"proj","version":"1.0.0","private":true,"devDependencies":{"lawcheck":"file:${dep}"}}\n`);
  }
  if (kind === 'pnpm') manager(kind, project, env, `pnpm add --save-dev file:${dep}`);
  if (kind === 'yarn1') manager(kind, project, env, `yarn add --dev file:${dep}`);
  rmSync(join(project, 'node_modules'), { recursive: true, force: true });
  git(project, env, 'init', '-q', '-b', 'main');
  git(project, env, 'add', '-A');
  git(project, env, 'commit', '-q', '-m', 'project');
  const template = join(dir, 'template.git');
  git(project, env, 'clone', '-q', '--bare', project, template);
  const count = git(project, env, 'ls-files').split('\n').length;
  return { dir, home, env, tarball: kept, kind, template, count };
}

export function removeCell(cell: Cell): void {
  rmSync(cell.dir, { recursive: true, force: true });
}

export interface Origin {
  url: string;
  builder: string;
  env: NodeJS.ProcessEnv;
}

let serial = 0;

export function newOrigin(cell: Cell): Origin {
  const name = `s${serial++}`;
  const bare = join(cell.dir, 'o', `${name}.git`);
  mkdirSync(join(cell.dir, 'o'), { recursive: true });
  cpSync(cell.template, bare, { recursive: true });
  const builder = join(cell.dir, 'b', name);
  mkdirSync(join(cell.dir, 'b'), { recursive: true });
  git(cell.dir, cell.env, 'clone', '-q', `file://${bare}`, builder);
  return { url: `file://${bare}`, builder, env: cell.env };
}

export function commit(origin: Origin, path: string, append: string, message: string): string {
  writeFileSync(join(origin.builder, path), readFileSync(join(origin.builder, path), 'utf8') + append);
  git(origin.builder, origin.env, 'commit', '-qam', message);
  return git(origin.builder, origin.env, 'rev-parse', 'HEAD');
}

export function sha(origin: Origin, ref: string): string {
  return git(origin.builder, origin.env, 'rev-parse', ref);
}

export function push(origin: Origin, ...refs: string[]): void {
  git(origin.builder, origin.env, 'push', '-q', '--force', 'origin', ...refs);
}

export function branch(origin: Origin, ...args: string[]): string {
  return git(origin.builder, origin.env, ...args);
}

// What actions/checkout does with the workflow's `with:`, a fetch and not a clone, so origin/HEAD does not exist: fetch-depth 0 is every branch, anything else is the ref at that depth.
export function checkout(cell: Cell, origin: Origin, ref: string, depthOverride: number | null = null): Checkout {
  const used = steps().find((step) => step.uses?.startsWith('actions/checkout'));
  if (used === undefined) throw new Error('the workflow has no actions/checkout step');
  const depth = depthOverride ?? Number(used.with?.['fetch-depth'] ?? 1);
  const dir = join(cell.dir, 'p', `w${serial++}`);
  mkdirSync(dir, { recursive: true });
  const env = cell.env;
  git(dir, env, 'init', '-q');
  git(dir, env, 'remote', 'add', 'origin', origin.url);
  if (depth === 0) git(dir, env, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*');
  else git(dir, env, 'fetch', '-q', `--depth=${depth}`, 'origin', `+refs/heads/${ref}:refs/remotes/origin/${ref}`);
  git(dir, env, 'checkout', '-q', '--detach', `origin/${ref}`);
  return { dir, ref };
}

export interface Ran {
  step: string;
  code: number | null;
  stdout: string;
  stderr: string;
}

// Runs the `run:` steps of the workflow, in order and as written, in the checkout. The job's install step is swapped for the page's own line of a manager the page gives one for.
export function runWorkflow(cell: Cell, at: Checkout, event: Event): Ran[] {
  const context: Record<string, string> = {
    'github.event_name': event.name,
    'github.base_ref': event.baseRef ?? '',
    'github.event.before': event.before ?? '',
    'github.event.merge_group.base_sha': event.mergeBase ?? '',
  };
  const out: Ran[] = [];
  for (const step of steps()) {
    if (step.run === undefined) continue;
    let script = step.run;
    if (script.trim() === 'npm install' && cell.kind === 'pnpm') script = example('ci-install-pnpm');
    if (script.trim() === 'npm install' && cell.kind === 'yarn1') script = example('ci-install-yarn');
    const env: NodeJS.ProcessEnv = { ...cell.env };
    for (const [key, value] of Object.entries(step.env ?? {})) env[key] = expand(String(value), context);
    const ran = bash(at.dir, expand(script, context), env);
    out.push({ step: step.name ?? script.split('\n')[0]!, code: ran.code, stdout: ran.stdout, stderr: ran.stderr });
    if (ran.code !== 0) break;
  }
  return out;
}

export function zeros(): string {
  return ZEROS;
}

export function install(cell: Cell, dir: string): Result {
  const script = cell.kind === 'pnpm' ? example('ci-install-pnpm') : cell.kind === 'yarn1' ? example('ci-install-yarn') : 'npm install';
  return bash(dir, script, cell.env);
}

export function hookFolder(dir: string): string {
  return join(dir, '.git', 'hooks');
}

export function writeHook(dir: string, name: string, text: string): void {
  const path = join(hookFolder(dir), name);
  writeFileSync(path, text + '\n');
  chmodSync(path, 0o755);
}

export function run(cwd: string, env: NodeJS.ProcessEnv, script: string): Result {
  return bash(cwd, script, env);
}

export { git as gitIn };
