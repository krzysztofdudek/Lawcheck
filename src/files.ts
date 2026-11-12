import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';

export class NoGit extends Error {}

export class GitFailed extends Error {}

interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const loose = new TextDecoder('utf-8', { ignoreBOM: true });

export function git(root: string, args: string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
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
        paths.push(strict.decode(output.subarray(start, i)));
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

export function listFiles(root: string): string[] {
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
  const result = git(root, args);
  if (result.status !== 0) throw failed(args, result);
  const files: string[] = [];
  for (const path of new Set(splitZ(result.stdout))) {
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

export function changedPaths(root: string, base: string): string[] {
  const diffArgs = ['diff', '-z', '--name-only', '--no-renames', '--relative', base, '--'];
  const diff = git(root, diffArgs);
  if (diff.status !== 0) throw failed(diffArgs, diff);
  const othersArgs = ['ls-files', '-z', '--others', '--exclude-standard'];
  const others = git(root, othersArgs);
  if (others.status !== 0) throw failed(othersArgs, others);
  return [...splitZ(diff.stdout), ...splitZ(others.stdout)];
}
