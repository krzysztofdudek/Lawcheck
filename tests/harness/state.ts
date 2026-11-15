import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const ENV: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const name of Object.keys(ENV)) if (name.startsWith('GIT_') && !['GIT_OPTIONAL_LOCKS', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'].includes(name)) delete ENV[name];

// Windows spells a folder in its short 8.3 form (RUNNER~1) in one place and in full in another; the native call gives the full form everywhere.
export const real = (path: string): string => realpathSync.native(path);

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  } catch {
    return null;
  }
}

export function gitTop(cwd: string): string | null {
  const out = git(cwd, ['rev-parse', '--show-toplevel']);
  return out === null ? null : real(out.trim());
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

// The git folders of a work tree: its own, and the common one of a linked worktree.
function gitDirs(top: string): string[] {
  const dot = join(top, '.git');
  if (!existsSync(dot)) return [];
  if (statSync(dot).isDirectory()) return [dot];
  const pointed = /^gitdir: (.*)$/m.exec(readFileSync(dot, 'utf8'))?.[1]?.trim();
  if (pointed === undefined) return [];
  const own = isAbsolute(pointed) ? pointed : join(top, pointed);
  const common = existsSync(join(own, 'commondir')) ? readFileSync(join(own, 'commondir'), 'utf8').trim() : null;
  return common === null ? [own] : [own, isAbsolute(common) ? common : join(own, common)];
}

const GIT_SKIP = new Set(['objects', 'logs', 'index', 'worktrees']);

// Everything in .git but its objects, its logs and the index, which is compared on its own: HEAD, the refs, packed-refs, config, config.worktree, hooks, info, shallow, description, ORIG_HEAD.
function gitFolder(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string) => {
    let names: string[];
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const name of names) {
      if (at === dir && GIT_SKIP.has(name)) continue;
      if (name.endsWith('.lock')) continue;
      const path = join(at, name);
      const rel = relative(dir, path).split(sep).join('/');
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        out.set(rel + '/', 'directory');
        walk(path);
      } else out.set(rel, digest(path));
    }
  };
  walk(dir);
  return out;
}

export interface GitState {
  top: string;
  index: string;
  git: Map<string, string>;
  // null when git cannot read the work tree, as in a test that breaks the repository on purpose.
  entries: Map<string, string> | null;
}

export function gitState(top: string): GitState {
  const status = git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=traditional', '--no-renames']);
  let entries: Map<string, string> | null = null;
  if (status !== null) {
    entries = new Map();
    for (const item of status.split('\0')) {
      if (item === '') continue;
      const path = item.slice(3);
      entries.set(path, `${item.slice(0, 2)} ${digest(join(top, path))}`);
    }
  }
  const index = git(top, ['ls-files', '-s', '-z']) ?? 'unreadable';
  const folder = new Map<string, string>();
  gitDirs(top).forEach((dir, k) => {
    for (const [path, value] of gitFolder(dir)) folder.set(`${k === 0 ? '.git' : '.git common'}/${path}`, value);
  });
  return { top, index, git: folder, entries };
}

export function gitChanges(before: GitState, after: GitState): { parts: string[]; paths: string[] } {
  const parts: string[] = [];
  if (before.entries !== null && after.entries === null) parts.push('the work tree, which git can no longer read');
  if (before.index !== after.index) parts.push('the index');
  parts.push(...changes(before.git, after.git));
  return { parts, paths: before.entries !== null && after.entries !== null ? changes(before.entries, after.entries) : [] };
}

function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set<string>();
  for (const [path, entry] of before) if (after.get(path) !== entry) paths.add(path);
  for (const path of after.keys()) if (!before.has(path)) paths.add(path);
  return [...paths].sort();
}

// The walk never enters .git or node_modules: git's own state is compared through gitState, and a node_modules here is a link to the checkout's.
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
  return changes(before, after);
}
