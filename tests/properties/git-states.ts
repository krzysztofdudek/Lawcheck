import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { append, check, git, GIT_ENV, lawcheck, makeSample, temp, write } from '../acceptance/helpers.ts';
import { tool } from './support.ts';
import type { Speed } from './support.ts';

interface Model {
  files: string[];
  branches: string[];
  rebasing: boolean;
  worktree: boolean;
}

interface Real {
  repo: string;
  dir: string;
}

const CONTENT = ['export const x = 1;\n', "console.log('x');\n", '// TODO later\n', "console.log(1); // lawcheck-waive no-console -- kept\n"];
const NAMES = ['src/core/n1.ts', 'src/core/n2.ts', 'src/cli/n3.ts', 'tools/n4.mjs', 'docs/n5.md'];

function quiet(repo: string, ...args: string[]): void {
  try {
    execFileSync('git', args, { cwd: repo, env: GIT_ENV, stdio: 'ignore' });
  } catch {
    // A merge or a rebase that stops on a conflict exits non-zero, and that state is the one wanted.
  }
}

class Command implements fc.AsyncCommand<Model, Real> {
  readonly label: string;
  readonly can: (m: Model) => boolean;
  readonly act: (m: Model, r: Real) => void;
  constructor(label: string, can: (m: Model) => boolean, act: (m: Model, r: Real) => void) {
    this.label = label;
    this.can = can;
    this.act = act;
  }
  check(m: Readonly<Model>): boolean {
    return this.can(m as Model);
  }
  async run(m: Model, r: Real): Promise<void> {
    this.act(m, r);
  }
  toString(): string {
    return this.label;
  }
}

const free = (m: Model) => !m.rebasing;
const commands = [
  fc.tuple(fc.constantFrom(...NAMES), fc.constantFrom(...CONTENT)).map(([path, content]) => new Command(`add ${path}`, free, (m, r) => {
    write(r.repo, path, content);
    if (!m.files.includes(path)) m.files.push(path);
  })),
  fc.tuple(fc.nat(), fc.constantFrom(...CONTENT)).map(([i, content]) => new Command(`edit ${i}`, (m) => free(m) && m.files.length > 0, (m, r) => append(r.repo, m.files[i % m.files.length]!, content))),
  fc.constant(new Command('stage', free, (_, r) => git(r.repo, 'add', '-A'))),
  fc.constant(new Command('commit', free, (_, r) => quiet(r.repo, 'commit', '-q', '-a', '--allow-empty', '-m', 'c'))),
  fc.nat().map((i) => new Command(`rename ${i}`, (m) => free(m) && m.files.length > 0, (m, r) => {
    const from = m.files[i % m.files.length]!;
    git(r.repo, 'add', '-A');
    const to = from.replace(/(\.\w+)$/, 'r$1');
    if (m.files.includes(to)) return;
    quiet(r.repo, 'mv', from, to);
    m.files[m.files.indexOf(from)] = to;
  })),
  fc.nat().map((i) => new Command(`delete ${i}`, (m) => free(m) && m.files.length > 0, (m, r) => {
    const path = m.files.splice(i % m.files.length, 1)[0]!;
    rmSync(join(r.repo, path), { force: true });
  })),
  fc.constant(new Command('branch', free, (m, r) => {
    const name = `b${m.branches.length}`;
    git(r.repo, 'add', '-A');
    quiet(r.repo, 'commit', '-q', '-m', 'before branch');
    git(r.repo, 'branch', name);
    m.branches.push(name);
  })),
  fc.nat().map((i) => new Command(`merge ${i}`, (m) => free(m) && m.branches.length > 0, (m, r) => {
    git(r.repo, 'add', '-A');
    quiet(r.repo, 'commit', '-q', '-m', 'before merge');
    quiet(r.repo, 'merge', '-q', '--no-edit', m.branches[i % m.branches.length]!);
    quiet(r.repo, 'merge', '--abort');
  })),
  fc.constant(new Command('stopped rebase', free, (m, r) => {
    git(r.repo, 'add', '-A');
    quiet(r.repo, 'commit', '-q', '-m', 'before rebase');
    const here = git(r.repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    quiet(r.repo, 'checkout', '-q', '-b', `other${m.branches.length}`, 'main');
    write(r.repo, 'src/core/price.ts', 'export const conflict = 1;\n');
    quiet(r.repo, 'commit', '-q', '-a', '-m', 'other');
    quiet(r.repo, 'checkout', '-q', here);
    write(r.repo, 'src/core/price.ts', 'export const mine = 2;\n');
    quiet(r.repo, 'commit', '-q', '-a', '-m', 'mine');
    quiet(r.repo, 'rebase', `other${m.branches.length}`);
    m.branches.push(`other${m.branches.length}`);
    const gitPath = (name: string) => execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-path', name], { cwd: r.repo, env: GIT_ENV, encoding: 'utf8' }).trim();
    m.rebasing = existsSync(gitPath('rebase-merge')) || existsSync(gitPath('rebase-apply'));
  })),
  fc.constant(new Command('worktree', (m) => free(m) && !m.worktree, (m, r) => {
    quiet(r.repo, 'worktree', 'add', '-q', join(r.dir, 'wt'), '-b', 'wt');
    m.worktree = existsSync(join(r.dir, 'wt'));
  })),
  fc.nat().map((i) => new Command(`assume-unchanged ${i}`, (m) => free(m) && m.files.length > 0, (m, r) => {
    const path = m.files[i % m.files.length]!;
    git(r.repo, 'add', path);
    quiet(r.repo, 'update-index', '--assume-unchanged', path);
    append(r.repo, path, "console.log('hidden');\n");
  })),
];

function gitState(repo: string): string {
  const status = execFileSync('git', ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], { cwd: repo, env: GIT_ENV });
  const refs = execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: repo, env: GIT_ENV });
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repo, env: GIT_ENV, encoding: 'utf8' }).trim();
  const index = existsSync(join(gitDir, 'index')) ? readFileSync(join(gitDir, 'index')) : Buffer.alloc(0);
  return createHash('sha256').update(status).update(refs).update(index).digest('hex');
}

// The files that differ from the merge base on disk, found without the tool: every listed regular file whose content git hashes to another blob than the merge base holds, or that the merge base lacks.
function truthChanged(repo: string): Set<string> {
  const run = (args: string[], input?: string) => execFileSync('git', args, { cwd: repo, env: GIT_ENV, input, encoding: 'utf8', maxBuffer: 1 << 26 });
  const fork = run(['merge-base', 'HEAD', 'main']).trim();
  const inBase = new Map<string, string>();
  for (const entry of run(['ls-tree', '-r', '-z', fork]).split('\0').filter(Boolean)) inBase.set(entry.slice(entry.indexOf('\t') + 1), entry.split(' ')[2]!.split('\t')[0]!);
  const listed = run(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter((path) => path !== '' && existsSync(join(repo, path)) && !lstatSync(join(repo, path)).isDirectory());
  const prefix = run(['rev-parse', '--show-prefix']).trim();
  const top = run(['rev-parse', '--show-toplevel']).trim();
  const ids = listed.length === 0 ? [] : execFileSync('git', ['hash-object', '--no-filters', '--stdin-paths'], { cwd: top, env: GIT_ENV, input: listed.map((path) => prefix + path).join('\n') + '\n', encoding: 'utf8' }).split('\n');
  return new Set(listed.filter((path, i) => inBase.get(path) !== ids[i]));
}

const key = (f: { file: string; line?: number; code: string; message: string }) => `${f.file}:${f.line ?? ''} ${f.code} ${f.message}`;

// Each property by its name, for tests/properties/git-states.test.ts and git-states.nightly.test.ts to register with its name written out.
export function gitStatesProperties(speed: Speed): Record<string, () => unknown> {
  const out: Record<string, () => unknown> = {};
  const test = (name: string, body: () => unknown) => {
    out[name] = body;
  };
  test('I-git-2: in any state a sequence of git commands leaves, a check changes nothing in git, its change gives what --full gives for those files, and it prints the same from below the root and twice', async () => {
    await tool(
      speed,
      fc.tuple(fc.boolean(), fc.commands([...commands, commands[0]!, commands[commands.length - 1]!, commands[commands.length - 1]!], { maxCommands: 6 })),
      {
        classes: {
          'a commit or a merge': ([, cmds]) => [...cmds].some((c) => /^(commit|merge|branch)/.test(String(c))),
          'a rename or a delete': ([, cmds]) => [...cmds].some((c) => /^(rename|delete)/.test(String(c))),
          'a rebase or a worktree': ([, cmds]) => [...cmds].some((c) => /^(stopped rebase|worktree)/.test(String(c))),
          'assume-unchanged': ([, cmds]) => [...cmds].some((c) => /^assume/.test(String(c))),
          'the law below the top of the work tree': ([below]) => below,
        },
      },
      async ([below, cmds]) => {
        const dir = temp();
        try {
          const top = makeSample(dir.dir, below ? { under: 'pkg' } : {});
          const repo = below ? join(top, 'pkg') : top;
          const model: Model = { files: ['src/core/price.ts', 'src/core/tax.ts', 'src/cli/main.ts', 'tools/release.mjs'], branches: [], rebasing: false, worktree: false };
          await fc.asyncModelRun(() => ({ model, real: { repo, dir: dir.dir } }), cmds);
          const before = gitState(repo);
          const change = await check(repo, '--base', 'main', '--json');
          const full = await check(repo, '--full', '--base', 'main', '--json');
          assert.equal(gitState(repo), before, 'a check changed the git state');
          assert.ok(change.code === 0 || change.code === 1 || change.code === 2, change.stdout);
          assert.doesNotMatch(change.stdout, /"code": "internal"/);
          if (change.code !== 2 && full.code !== 2) {
            const a = JSON.parse(change.stdout);
            const b = JSON.parse(full.stdout);
            assert.deepEqual(a.findings, b.findings.filter((f: { debt: boolean }) => !f.debt), `the change: ${String(cmds)}`);
            const truth = truthChanged(repo);
            const ofTruth = b.findings.filter((f: { file: string; code: string }) => truth.has(f.file) && f.code !== 'uses-not-read').map(key).sort();
            assert.deepEqual(a.findings.filter((f: { code: string }) => f.code !== 'uses-not-read').map(key).sort(), ofTruth, `the files that changed on disk: ${[...truth].join(', ')}; ${String(cmds)}`);
          }
          const text = await check(repo, '--base', 'main');
          for (const sub of ['src', 'src/core']) {
            if (!existsSync(join(repo, sub))) continue;
            const below = await lawcheck(join(repo, sub), ['check', '--base', 'main']);
            assert.deepEqual([below.code, below.stdout], [text.code, text.stdout], `from ${sub}`);
          }
          const again = await check(repo, '--base', 'main');
          assert.deepEqual([again.code, again.stdout], [text.code, text.stdout], 'a second run');
          if (model.worktree) {
            const there = await lawcheck(join(dir.dir, 'wt', below ? 'pkg' : ''), ['check', '--base', 'main']);
            assert.ok(there.code === 0 || there.code === 1, there.stdout);
          }
          assert.equal(gitState(repo), before, 'the runs changed the git state');
        } finally {
          dir.remove();
        }
      },
    );
  });
  return out;
}
