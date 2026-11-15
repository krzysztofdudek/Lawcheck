import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ENV: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const name of Object.keys(ENV)) if (name.startsWith('GIT_') && !['GIT_OPTIONAL_LOCKS', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'].includes(name)) delete ENV[name];

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

export function gitTop(cwd: string): string | null {
  const out = git(cwd, ['rev-parse', '--show-toplevel']);
  return out === null ? null : out.trim();
}

function digest(path: string): string {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return `link ${readlinkSync(path)}`;
    if (stat.isDirectory()) return 'directory';
    if (!stat.isFile()) return 'other';
    return createHash('sha1').update(readFileSync(path)).digest('hex');
  } catch {
    return 'unreadable';
  }
}

export interface GitState {
  top: string;
  head: string;
  index: string;
  config: string;
  entries: Map<string, string>;
}

export function gitState(top: string): GitState | null {
  const status = git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=traditional', '--no-renames']);
  if (status === null) return null;
  const entries = new Map<string, string>();
  for (const item of status.split('\0')) {
    if (item === '') continue;
    const path = item.slice(3);
    entries.set(path, `${item.slice(0, 2)} ${digest(join(top, path))}`);
  }
  const head = git(top, ['rev-parse', '--symbolic-full-name', 'HEAD']) ?? '';
  const commit = git(top, ['rev-parse', '-q', '--verify', 'HEAD']) ?? '';
  const index = git(top, ['ls-files', '-s', '-z']) ?? '';
  const gitDir = git(top, ['rev-parse', '--absolute-git-dir'])?.trim();
  return { top, head: head.trim() + ' ' + commit.trim(), index, config: gitDir ? digest(join(gitDir, 'config')) : '', entries };
}

export function gitChanges(before: GitState, after: GitState): { head: boolean; index: boolean; config: boolean; paths: string[] } {
  const paths = new Set<string>();
  for (const [path, entry] of before.entries) if (after.entries.get(path) !== entry) paths.add(path);
  for (const path of after.entries.keys()) if (!before.entries.has(path)) paths.add(path);
  return { head: before.head !== after.head, index: before.index !== after.index, config: before.config !== after.config, paths: [...paths].sort() };
}

const SKIP = new Set(['.git', 'node_modules']);

export function treeState(root: string, skip: Set<string> = SKIP): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (dir === root && skip.has(name)) continue;
      const path = join(dir, name);
      try {
        const stat = lstatSync(path);
        const rel = relative(root, path).split(sep).join('/');
        if (stat.isDirectory()) {
          out.set(rel + '/', 'directory');
          walk(path);
        } else out.set(rel, `${stat.size} ${stat.mtimeMs}`);
      } catch {
        continue;
      }
    }
  };
  walk(root);
  return out;
}

export function treeChanges(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set<string>();
  for (const [path, entry] of before) if (after.get(path) !== entry) paths.add(path);
  for (const path of after.keys()) if (!before.has(path)) paths.add(path);
  return [...paths].sort();
}
