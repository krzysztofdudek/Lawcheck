import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

// Windows spells a folder in its short 8.3 form (RUNNER~1) in one place and in full in another; the native call gives the full form everywhere.
export const real = (path: string): string => realpathSync.native(path);

// The top of the work tree is the nearest folder at or above cwd that holds .git, found without starting git.
export function gitTop(cwd: string): string | null {
  for (let dir = real(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

// A file is known by its size, its time of change and its mode, which every write moves; reading every file on each snapshot cost seconds on Windows.
function digest(path: string): string {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return `link ${readlinkSync(path)}`;
    if (stat.isDirectory()) return 'directory';
    if (!stat.isFile()) return 'other';
    return `${stat.size} ${stat.mtimeMs} ${stat.mode}`;
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

const GIT_SKIP = new Set(['objects', 'logs', 'worktrees']);

// Everything in .git but its objects and its logs: HEAD, the refs, packed-refs, the index, config, config.worktree, hooks, info, shallow, description, ORIG_HEAD. The index is compared by its bytes: git may write it again with the same content.
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
      } else out.set(rel, rel === 'index' ? createHash('sha1').update(readFileSync(path)).digest('hex') : digest(path));
    }
  };
  walk(dir);
  return out;
}

export interface GitState {
  top: string;
  git: Map<string, string>;
  entries: Map<string, string>;
}

// The work tree is walked, not asked of git: a walk sees ignored files and empty folders too, and starting git twice for every run cost seconds on Windows.
export function gitState(top: string): GitState {
  const folder = new Map<string, string>();
  gitDirs(top).forEach((dir, k) => {
    for (const [path, value] of gitFolder(dir)) folder.set(`${k === 0 ? '.git' : '.git common'}/${path}`, value);
  });
  return { top, git: folder, entries: tree(top) };
}

export function gitChanges(before: GitState, after: GitState): { parts: string[]; paths: string[] } {
  return { parts: changes(before.git, after.git), paths: changes(before.entries, after.entries) };
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
