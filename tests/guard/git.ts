import { execFileSync } from 'node:child_process';

export class GitError extends Error {}

export function git(repo: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    throw new GitError(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

export function resolve(repo: string, rev: string): string | null {
  try {
    return git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

export class Tree {
  readonly repo: string;
  readonly rev: string;
  private files: Set<string> | null = null;
  private cache = new Map<string, string | null>();

  constructor(repo: string, rev: string) {
    this.repo = repo;
    this.rev = rev;
  }

  list(): Set<string> {
    if (!this.files) {
      this.files = new Set(git(this.repo, ['ls-tree', '-r', '-z', '--name-only', this.rev]).split('\0').filter(Boolean));
    }
    return this.files;
  }

  has(path: string): boolean {
    return this.list().has(path);
  }

  read(path: string): string | null {
    if (this.cache.has(path)) return this.cache.get(path)!;
    const text = this.has(path) ? git(this.repo, ['cat-file', 'blob', `${this.rev}:${path}`]) : null;
    this.cache.set(path, text);
    return text;
  }
}

export type Change = { status: 'A' | 'M' | 'D' | 'R' | 'T'; path: string; from: string };

export function changes(repo: string, base: string, head: string): Change[] {
  const out = git(repo, ['diff', '--name-status', '-z', '-M', '-l0', base, head]).split('\0');
  const list: Change[] = [];
  for (let i = 0; i < out.length; i++) {
    const code = out[i];
    if (!code) continue;
    const letter = code[0] as string;
    if (letter === 'R' || letter === 'C') {
      const from = out[++i]!;
      const to = out[++i]!;
      if (letter === 'R') list.push({ status: 'R', path: to, from });
      else list.push({ status: 'A', path: to, from: to });
      continue;
    }
    const path = out[++i]!;
    const status = (['A', 'M', 'D', 'T'].includes(letter) ? letter : 'M') as Change['status'];
    list.push({ status, path, from: path });
  }
  return list;
}
