import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, statSync, utimesSync } from 'node:fs';
import { devNull } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { findProgram } from './programs.js';
import { guardedFolder, releaseFolder } from './rules.js';
import { bytesOfName, nameOf, onDisk, quotedLine } from './names.js';
import { receiveMessageOnPort } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import { step } from './progress.js';

export class NoGit extends Error {}

export class GitFailed extends Error {
  constructor(message: string, readonly status: number | null = null, readonly printed = '') {
    super(message);
  }
}

interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}

const loose = new TextDecoder('utf-8', { ignoreBOM: true });

export interface GitRequest {
  program: string;
  root: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  input?: Uint8Array;
}

export interface GitReply {
  error: { code: string | null; message: string } | null;
  status: number | null;
  signal: string | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

let channel: { port: MessagePort; flag: Int32Array } | null = null;

// In the worker git runs in the main thread, which can end it at a signal; the worker waits for its reply as a synchronous call would.
export function gitThroughMainThread(port: MessagePort, flag: SharedArrayBuffer): void {
  channel = { port, flag: new Int32Array(flag) };
}

function run(request: GitRequest): GitReply {
  if (channel === null) {
    const result = spawnSync(request.program, request.args, { cwd: request.root, env: request.env, input: request.input, maxBuffer: 1 << 30, stdio: [request.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const error = result.error ? { code: (result.error as NodeJS.ErrnoException).code ?? null, message: result.error.message } : null;
    return { error, status: result.status, signal: result.signal, stdout: result.stdout ?? new Uint8Array(), stderr: result.stderr ?? new Uint8Array() };
  }
  Atomics.store(channel.flag, 0, 0);
  channel.port.postMessage(request);
  for (;;) {
    Atomics.wait(channel.flag, 0, 0);
    const reply = receiveMessageOnPort(channel.port);
    if (reply !== undefined) return reply.message as GitReply;
    Atomics.store(channel.flag, 0, 0);
  }
}

const filters = new Map<string, string[]>();

function filterKeys(program: string, cwd: string): string[] {
  let keys = filters.get(cwd);
  if (keys === undefined) {
    const listed = run({ program, root: cwd, args: ['config', '-z', '--name-only', '--get-regexp', '^filter\\.'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    keys = listed.status === 0 ? new TextDecoder().decode(listed.stdout).split('\0').filter((key) => /^filter\..+\.(clean|smudge|process)$/.test(key)) : [];
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

export function git(root: string, args: string[], extra: NodeJS.ProcessEnv = {}, input?: Buffer): GitResult {
  // git by its path on PATH, so no relative entry and no current folder can put the repository's own git in its place; Windows starts git.exe alone.
  gitProgram ??= findProgram('git', { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATHEXT')), PATHEXT: '.EXE' });
  if (gitProgram === null) throw new NoGit('git cannot be started: it is not on the PATH');
  step(`running git ${args.join(' ')}`);
  const result = run({ program: gitProgram, root, args, env: { ...startsNothing(gitProgram, root), ...extra }, input });
  if (result.error) {
    const code = result.error.code;
    if (code === 'ENOENT' || code === 'EACCES') throw new NoGit(`git cannot be started: ${result.error.message}`);
    throw new GitFailed(`git ${args[0]} failed: ${result.error.message}`);
  }
  if (result.status === null) throw new GitFailed(`git ${args[0]} ended by the signal ${result.signal}`);
  return { status: result.status, stdout: Buffer.from(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength), stderr: Buffer.from(result.stderr.buffer, result.stderr.byteOffset, result.stderr.byteLength) };
}

function firstPrinted(result: GitResult): string {
  const text = loose.decode(result.stderr.length > 0 ? result.stderr : result.stdout);
  return text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
}

function failed(args: string[], result: GitResult): GitFailed {
  return new GitFailed(`git ${args.join(' ')} exited with ${result.status}: ${firstPrinted(result)}`, result.status, firstPrinted(result));
}

export function splitZ(output: Buffer): string[] {
  const paths: string[] = [];
  let start = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] !== 0) continue;
    if (i > start) paths.push(nameOf(output.subarray(start, i)));
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

function quoted(path: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}

function repositoryAbove(dir: string): string | null {
  for (let at = resolve(dir); ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) return at;
    if (dirname(at) === at) return null;
  }
}

// The fetch of one branch, for a base that a CI variable or a flag may have named. It is printed only when git accepts both refs and a POSIX shell reads it as one git fetch: a name with a character that the output escapes, or a remote that git would read as an option, gives none.
export function fetchCommand(root: string, remote: string, branch: string, shallow: boolean): string | null {
  if (remote.startsWith('-') || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(remote + branch)) return null;
  const source = `refs/heads/${branch}`;
  const target = `refs/remotes/${remote}/${branch}`;
  if (git(root, ['check-ref-format', source]).status !== 0 || git(root, ['check-ref-format', target]).status !== 0) return null;
  return `git fetch${shallow ? ' --unshallow' : ''} ${quoted(remote)} ${quoted(`+${source}:${target}`)}`;
}

// What git's own sentence asks of the user, where the plain next line of no-git would send them to the work tree they are in. The command is written for a POSIX shell, as docs/ci.md says.
export function gitNext(dir: string, problem: string): { next: string; command?: string } | undefined {
  const dubious = /dubious ownership in repository at '(.*)'\s*$/.exec(problem);
  if (dubious !== null) {
    const command = `git config --global --add safe.directory ${quoted(dubious[1]!)}`;
    return { next: `let git trust the repository: ${command}, then run lawcheck check`, command };
  }
  const repository = /not a git repository/.test(problem) ? repositoryAbove(dir) : null;
  if (repository !== null) return { next: `repair the repository at ${repository}, so that git status works there, then run lawcheck check` };
  return undefined;
}

export function listFiles(root: string, listed: Set<string> = listedPaths(root)): string[] {
  const files: string[] = [];
  for (const path of listed) {
    try {
      if (lstatSync(onDisk(root, path)).isFile()) files.push(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A path git lists below a folder that cannot be searched may be a file; reading it later names it as unreadable when a type takes it.
      if (code === 'EACCES' || code === 'EPERM') files.push(path);
      else if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
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

export function remoteNames(root: string): string[] {
  const result = git(root, ['remote']);
  return result.status === 0 ? loose.decode(result.stdout).split(/\r?\n/).filter((name) => name !== '') : [];
}

// A clone made with --single-branch or --depth fetches one branch; its fetch lines name no refs/heads/*.
export function fetchesEveryBranch(root: string, remote: string): boolean {
  const result = git(root, ['config', '--get-all', `remote.${remote}.fetch`]);
  return result.status !== 0 || loose.decode(result.stdout).split(/\r?\n/).some((line) => line.includes('refs/heads/*'));
}

export function isShallow(root: string): boolean {
  const result = git(root, ['rev-parse', '--is-shallow-repository']);
  return result.status === 0 && loose.decode(result.stdout).trim() === 'true';
}

export function mergeBase(root: string, commit: string): string | null {
  const args = ['merge-base', 'HEAD', commit];
  const result = git(root, args);
  if (result.status === 0) return loose.decode(result.stdout).trim();
  if (result.status === 1) return null;
  throw failed(args, result);
}

// git diff writes the index again when the times of its files no longer match it, whatever GIT_OPTIONAL_LOCKS says, so the change is read through a copy of the index. A copy that keeps the index's modification time, cut to the whole second, lets git read a file changed in the second the index was written by its content; on a copy with a fresh time git trusts a same-size edit of that second as unchanged.
function onIndexCopy<T>(root: string, keepTime: boolean, read: (env: NodeJS.ProcessEnv) => T): T {
  const pathArgs = ['rev-parse', '--git-path', 'index'];
  const found = git(root, pathArgs);
  if (found.status !== 0) throw failed(pathArgs, found);
  const resolved = resolve(root, loose.decode(found.stdout).replace(/\r?\n$/, ''));
  if (!existsSync(resolved)) return read({});
  let folder: string;
  try {
    folder = guardedFolder('lawcheck-index-');
  } catch {
    // Without a temporary folder the diff reads the index itself: the change is the same, and git may write the index again with fresh times.
    return read({});
  }
  try {
    try {
      const copy = join(folder, 'index');
      const { atimeMs, mtimeMs } = statSync(resolved);
      copyFileSync(resolved, copy);
      utimesSync(copy, atimeMs / 1000, keepTime ? Math.floor(mtimeMs / 1000) : Math.floor(Math.max(Date.now(), mtimeMs) / 1000) + 86_400);
    } catch {
      return read({});
    }
    return read({ GIT_INDEX_FILE: join(folder, 'index') });
  } finally {
    releaseFolder(folder);
  }
}

export function changedPaths(root: string, base: string): string[] {
  const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '-z', '--name-only', '--no-renames', '--relative', base, '--'];
  const diff = onIndexCopy(root, true, (env) => git(root, diffArgs, env));
  if (diff.status !== 0) throw failed(diffArgs, diff);
  const othersArgs = ['ls-files', '-z', '--others', '--exclude-standard'];
  const others = git(root, othersArgs);
  if (others.status !== 0) throw failed(othersArgs, others);
  return [...byTimeWhenFiltered(root, diffArgs, splitZ(diff.stdout)), ...splitZ(others.stdout), ...hiddenEdits(root, base)];
}

// git runs no clean filter for Lawcheck, so it hashes a file of Git LFS or another filter as its bytes on disk, which are not the bytes it stores; read by its content because it is not older than the index, as after a checkout, such a file would count as changed. It counts as changed only when its time or size differs from the index, as the diff on a copy dated a day ahead finds: a copy with a fresh time is still in the second of a checkout that just ended, and git would read the file by its content again.
function byTimeWhenFiltered(root: string, diffArgs: string[], listed: string[]): string[] {
  if (listed.length === 0 || !gitProgram) return listed;
  const drivers = new Set(filterKeys(gitProgram, root).filter((key) => !key.endsWith('.smudge')).map((key) => key.slice('filter.'.length, key.lastIndexOf('.'))));
  if (drivers.size === 0) return listed;
  const attrArgs = ['check-attr', '-z', '--stdin', 'filter'];
  const attrs = git(root, attrArgs, {}, Buffer.concat(listed.flatMap((path) => [bytesOfName(path), Buffer.from([0])])));
  if (attrs.status !== 0) throw failed(attrArgs, attrs);
  const fields = attrs.stdout.toString('utf8').split('\0');
  const filtered = listed.map((_, i) => drivers.has(fields[i * 3 + 2] ?? ''));
  if (!filtered.includes(true)) return listed;
  const fresh = onIndexCopy(root, false, (env) => git(root, diffArgs, env));
  if (fresh.status !== 0) throw failed(diffArgs, fresh);
  const byTime = new Set(splitZ(fresh.stdout));
  return listed.filter((path, i) => !filtered[i] || byTime.has(path));
}

// git's diff trusts the index for a file marked assume-unchanged or skip-worktree (a sparse checkout sets the second), so an edit of one on disk is found by its content (stress finding S1-14).
function hiddenEdits(root: string, base: string): string[] {
  const listArgs = ['ls-files', '-v', '-z'];
  const listed = git(root, listArgs);
  if (listed.status !== 0) throw failed(listArgs, listed);
  const marked: Buffer[] = [];
  let start = 0;
  const out = listed.stdout;
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== 0) continue;
    const tag = out[start]!;
    if (i - start > 2 && ((tag >= 0x61 && tag <= 0x7a) || tag === 0x53)) {
      const bytes = out.subarray(start + 2, i);
      try {
        if (lstatSync(onDisk(root, nameOf(bytes))).isFile()) marked.push(bytes);
      } catch {
        // A marked file that is gone is the index's business; git's diff shows a deletion only when the index changed.
      }
    }
    start = i + 1;
  }
  if (marked.length === 0) return [];
  const hashArgs = ['hash-object', '--stdin-paths'];
  const prefix = showPrefix(root);
  const hashed = git(root, hashArgs, {}, Buffer.concat(marked.map((bytes) => quotedLine(prefix, bytes))));
  if (hashed.status !== 0) throw failed(hashArgs, hashed);
  const ids = hashed.stdout.toString('utf8').split('\n');
  const treeArgs = ['ls-tree', '-r', '-z', base];
  const tree = git(root, treeArgs);
  if (tree.status !== 0) throw failed(treeArgs, tree);
  const inBase = new Map<string, string>();
  for (const entry of splitZ(tree.stdout)) {
    const tab = entry.indexOf('\t');
    inBase.set(entry.slice(tab + 1), entry.slice(0, tab).split(' ')[2]!);
  }
  return marked.map((bytes) => nameOf(bytes)).filter((name, i) => inBase.get(name) !== ids[i]);
}

export function showPrefix(dir: string): string {
  const args = ['rev-parse', '--show-prefix'];
  const result = git(dir, args);
  if (result.status !== 0) throw failed(args, result);
  return loose.decode(result.stdout).replace(/\r?\n$/, '');
}

export function ignoresPath(root: string, path: string): boolean {
  const args = ['check-ignore', '-q', '--no-index', '--stdin', '-z'];
  const result = git(root, args, {}, Buffer.concat([bytesOfName(path), Buffer.from([0])]));
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw failed(args, result);
}

export interface TrackedLink {
  name: string;
  bytes: Buffer;
}

// Every link git tracks under the root and in its checked-out submodules, by its bytes: a name with a line break or bytes that are not UTF-8 is a link like any other. Each submodule is listed in its own folder, since git 2.34 refuses --recurse-submodules with --stage.
export function trackedLinks(root: string): TrackedLink[] {
  const links: TrackedLink[] = [];
  const list = (dir: Buffer, prefix: Buffer) => {
    const args = ['ls-files', '-z', '--stage'];
    const result = git(dir.toString('utf8'), args);
    if (result.status !== 0) throw failed(args, result);
    let start = 0;
    for (let i = 0; i < result.stdout.length; i++) {
      if (result.stdout[i] !== 0) continue;
      const entry = result.stdout.subarray(start, i);
      start = i + 1;
      const tab = entry.indexOf(9);
      if (tab < 0) continue;
      const path = Buffer.from(entry.subarray(tab + 1));
      const mode = entry.subarray(0, 7).toString('latin1');
      if (mode === '120000 ') {
        const bytes = Buffer.concat([prefix, path]);
        links.push({ name: loose.decode(bytes), bytes });
      } else if (mode === '160000 ') {
        const sub = Buffer.concat([dir, Buffer.from(sep), path]);
        if (existsSync(Buffer.concat([sub, Buffer.from(sep + '.git')]))) list(sub, Buffer.concat([prefix, path, Buffer.from('/')]));
      }
    }
  };
  list(Buffer.from(root), Buffer.alloc(0));
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

export interface Nested {
  dir: string;
  submodule: boolean;
}

// A submodule is listed as its directory, and an untracked repository inside the work tree as its directory with a trailing slash; git lists no file of either.
export function nestedRepositories(root: string, listed: Set<string>): Nested[] {
  const out: Nested[] = [];
  for (const path of listed) {
    const dir = path.endsWith('/') ? path.slice(0, -1) : path;
    try {
      if (lstatSync(onDisk(root, dir)).isDirectory()) out.push({ dir, submodule: !path.endsWith('/') });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') throw error;
    }
  }
  return out.sort((a, b) => comparePaths(a.dir, b.dir));
}

export function repositoryHolding(root: string, path: string, listed: Set<string>): Nested | null {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    if (listed.has(dir) || listed.has(`${dir}/`)) {
      try {
        if (lstatSync(onDisk(root, dir)).isDirectory()) return { dir, submodule: listed.has(dir) };
      } catch {
        return null;
      }
    }
    try {
      lstatSync(onDisk(root, `${dir}/.git`));
      return { dir, submodule: false };
    } catch {
      // No repository of its own at this level.
    }
  }
  return null;
}

export function nestedReason(nested: Nested): string {
  return `it lies in ${nested.dir}, ${nested.submodule ? 'a submodule' : 'a repository of its own'}, which Lawcheck does not look into`;
}
