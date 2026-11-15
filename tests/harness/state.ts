import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const ENV: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const name of Object.keys(ENV)) if (name.startsWith('GIT_') && !['GIT_OPTIONAL_LOCKS', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'].includes(name)) delete ENV[name];

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
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
    return 'absent';
  }
}

function folderDigest(dir: string): string {
  if (!existsSync(dir)) return 'absent';
  return [...tree(dir).entries()].map(([path]) => `${path} ${digest(join(dir, path))}`).join('\n');
}

export interface GitState {
  top: string;
  head: string;
  refs: string;
  index: string;
  config: string;
  hooks: string;
  exclude: string;
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
  const refs = git(top, ['for-each-ref', '--format=%(refname) %(objectname)']) ?? '';
  const index = git(top, ['ls-files', '-s', '-z']) ?? '';
  let common = git(top, ['rev-parse', '--git-common-dir'])?.trim() ?? '';
  if (common !== '' && !isAbsolute(common)) common = join(top, common);
  const gitDir = common === '' ? null : common;
  return {
    top,
    head: head.trim() + ' ' + commit.trim(),
    refs,
    index,
    config: gitDir ? digest(join(gitDir, 'config')) : '',
    hooks: gitDir ? folderDigest(join(gitDir, 'hooks')) : '',
    exclude: gitDir ? digest(join(gitDir, 'info', 'exclude')) : '',
    entries,
  };
}

export function gitChanges(before: GitState, after: GitState): { parts: string[]; paths: string[] } {
  const paths = new Set<string>();
  for (const [path, entry] of before.entries) if (after.entries.get(path) !== entry) paths.add(path);
  for (const path of after.entries.keys()) if (!before.entries.has(path)) paths.add(path);
  const parts: string[] = [];
  if (before.head !== after.head) parts.push('HEAD');
  if (before.refs !== after.refs) parts.push('the refs');
  if (before.index !== after.index) parts.push('the index');
  if (before.config !== after.config) parts.push('.git/config');
  if (before.hooks !== after.hooks) parts.push('.git/hooks');
  if (before.exclude !== after.exclude) parts.push('.git/info/exclude');
  return { parts, paths: [...paths].sort() };
}

// The walk never enters .git or node_modules: git's own state is compared through git, and a node_modules here is a link to the checkout's.
export function tree(root: string, skipTop: (name: string) => boolean = () => false): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === '.git' || name === 'node_modules') continue;
      if (dir === root && skipTop(name)) continue;
      const path = join(dir, name);
      try {
        const stat = lstatSync(path);
        const rel = relative(root, path).split(sep).join('/');
        if (stat.isDirectory()) {
          out.set(rel + '/', 'directory');
          walk(path);
        } else out.set(rel, `${stat.size} ${stat.mtimeMs} ${stat.mode}`);
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
