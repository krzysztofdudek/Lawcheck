import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findProgram } from './programs.js';

export class NoGit extends Error {}

export class GitFailed extends Error {}

interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const loose = new TextDecoder('utf-8', { ignoreBOM: true });

const filters = new Map<string, string[]>();

function filterKeys(program: string, cwd: string): string[] {
  let keys = filters.get(cwd);
  if (keys === undefined) {
    const listed = spawnSync(program, ['config', '-z', '--name-only', '--get-regexp', '^filter\\.'], {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      maxBuffer: 1 << 24,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    keys = listed.status === 0 ? listed.stdout.toString('utf8').split('\0').filter((key) => /^filter\..+\.(clean|smudge|process)$/.test(key)) : [];
    filters.set(cwd, keys);
  }
  return keys;
}

// A repository's config and attributes can name programs that git starts while it only reads; these settings start none of them.
function startsNothing(program: string, cwd: string): NodeJS.ProcessEnv {
  const settings: [string, string][] = [
    ['core.fsmonitor', ''],
    ['core.hooksPath', devNull],
    ['diff.external', ''],
  ];
  for (const key of filterKeys(program, cwd)) settings.push([key, ''], [`${key.slice(0, key.lastIndexOf('.'))}.required`, 'false']);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  const given = Number(env.GIT_CONFIG_COUNT);
  const start = Number.isInteger(given) && given > 0 ? given : 0;
  settings.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${start + index}`] = key;
    env[`GIT_CONFIG_VALUE_${start + index}`] = value;
  });
  env.GIT_CONFIG_COUNT = String(start + settings.length);
  return env;
}

let gitProgram: string | null | undefined;

export function git(root: string, args: string[], extra: NodeJS.ProcessEnv = {}): GitResult {
  // git by its path on PATH, so no relative entry and no current folder can put the repository's own git in its place; Windows starts git.exe alone.
  gitProgram ??= findProgram('git', { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATHEXT')), PATHEXT: '.EXE' });
  if (gitProgram === null) throw new NoGit('git cannot be started: it is not on the PATH');
  const result = spawnSync(gitProgram, args, {
    cwd: root,
    env: { ...startsNothing(gitProgram, root), ...extra },
    maxBuffer: 1 << 30,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES') throw new NoGit(`git cannot be started: ${result.error.message}`);
    throw new GitFailed(`git ${args[0]} failed: ${result.error.message}`);
  }
  if (result.status === null) throw new GitFailed(`git ${args[0]} ended by the signal ${result.signal}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function firstPrinted(result: GitResult): string {
  const text = loose.decode(result.stderr.length > 0 ? result.stderr : result.stdout);
  return text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
}

function failed(args: string[], result: GitResult): GitFailed {
  return new GitFailed(`git ${args.join(' ')} exited with ${result.status}: ${firstPrinted(result)}`);
}

export function splitZ(output: Buffer): string[] {
  const paths: string[] = [];
  let start = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] !== 0) continue;
    if (i > start) {
      try {
        const path = strict.decode(output.subarray(start, i));
        if (!/[\r\n]/.test(path)) paths.push(path);
      } catch {
        // A path that is not valid UTF-8 is left out on purpose.
      }
    }
    start = i + 1;
  }
  return paths;
}

export function workTreeProblem(root: string): string | null {
  const args = ['rev-parse', '--is-inside-work-tree'];
  const result = git(root, args);
  const word = loose.decode(result.stdout).trim();
  if (result.status === 0 && word === 'true') return null;
  return `git does not see a work tree here: ${firstPrinted(result)}`;
}

export function listFiles(root: string, listed: Set<string> = listedPaths(root)): string[] {
  const files: string[] = [];
  for (const path of listed) {
    try {
      if (lstatSync(join(root, path)).isFile()) files.push(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
  }
  return files.sort(comparePaths);
}

export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function hasHead(root: string): boolean {
  const args = ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'];
  const result = git(root, args);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw failed(args, result);
}

export function defaultBase(root: string): string | null {
  const args = ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'];
  const result = git(root, args);
  if (result.status === 0) return loose.decode(result.stdout).trim();
  if (result.status === 1) return null;
  throw failed(args, result);
}

export function resolveCommit(root: string, base: string): string | null {
  const result = git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`]);
  return result.status === 0 ? loose.decode(result.stdout).trim() : null;
}

export function mergeBase(root: string, commit: string): string | null {
  const args = ['merge-base', 'HEAD', commit];
  const result = git(root, args);
  if (result.status === 0) return loose.decode(result.stdout).trim();
  if (result.status === 1) return null;
  throw failed(args, result);
}

// git diff writes the index again when the times of its files no longer match it, whatever GIT_OPTIONAL_LOCKS says, so the change is read through a copy of the index.
function onIndexCopy<T>(root: string, read: (env: NodeJS.ProcessEnv) => T): T {
  const pathArgs = ['rev-parse', '--git-path', 'index'];
  const found = git(root, pathArgs);
  if (found.status !== 0) throw failed(pathArgs, found);
  const resolved = resolve(root, loose.decode(found.stdout).replace(/\r?\n$/, ''));
  if (!existsSync(resolved)) return read({});
  const folder = mkdtempSync(join(tmpdir(), 'lawcheck-index-'));
  try {
    copyFileSync(resolved, join(folder, 'index'));
    return read({ GIT_INDEX_FILE: join(folder, 'index') });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export function changedPaths(root: string, base: string): string[] {
  const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '-z', '--name-only', '--no-renames', '--relative', base, '--'];
  const diff = onIndexCopy(root, (env) => git(root, diffArgs, env));
  if (diff.status !== 0) throw failed(diffArgs, diff);
  const othersArgs = ['ls-files', '-z', '--others', '--exclude-standard'];
  const others = git(root, othersArgs);
  if (others.status !== 0) throw failed(othersArgs, others);
  return [...splitZ(diff.stdout), ...splitZ(others.stdout)];
}

export function showPrefix(dir: string): string {
  const args = ['rev-parse', '--show-prefix'];
  const result = git(dir, args);
  if (result.status !== 0) throw failed(args, result);
  return loose.decode(result.stdout).replace(/\r?\n$/, '');
}

export function ignoresPath(root: string, path: string): boolean {
  const args = ['check-ignore', '-q', '--no-index', '--', path];
  const result = git(root, args);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw failed(args, result);
}

export interface TrackedLink {
  name: string;
  bytes: Buffer;
}

// Every link git tracks under the root and in its submodules, by its bytes: a name with a line break or bytes that are not UTF-8 is a link like any other.
export function trackedLinks(root: string): TrackedLink[] {
  const args = ['ls-files', '-z', '--stage', '--recurse-submodules'];
  const result = git(root, args);
  if (result.status !== 0) throw failed(args, result);
  const links: TrackedLink[] = [];
  let start = 0;
  for (let i = 0; i < result.stdout.length; i++) {
    if (result.stdout[i] !== 0) continue;
    const entry = result.stdout.subarray(start, i);
    start = i + 1;
    const tab = entry.indexOf(9);
    if (tab < 0 || !entry.subarray(0, 7).equals(Buffer.from('120000 '))) continue;
    const bytes = Buffer.from(entry.subarray(tab + 1));
    links.push({ name: loose.decode(bytes), bytes });
  }
  return links;
}

export function workTreeTop(root: string): string {
  const args = ['rev-parse', '--show-toplevel'];
  const result = git(root, args);
  if (result.status !== 0) throw failed(args, result);
  return loose.decode(result.stdout).replace(/\r?\n$/, '');
}

export function listedPaths(root: string): Set<string> {
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
  const result = git(root, args);
  if (result.status !== 0) throw failed(args, result);
  return new Set(splitZ(result.stdout));
}
