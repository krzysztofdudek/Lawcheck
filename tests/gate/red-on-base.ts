import { resolve as resolveMain } from 'node:path';
import { resolve as resolvePath } from 'node:path';
import { git, resolve, Tree } from '../guard/git.ts';
import { matchesAny } from '../guard/glob.ts';
import { loadConfig } from '../guard/guard.ts';
import { namePattern, readSource, type TestCall } from '../guard/source.ts';
import { build, headWithBaseSrc, linkShared, runTests, tempDir } from './copy.ts';
import { readTap, verdictOf, type Verdict } from './tap.ts';

export type Changed = { id: string; file: string; line: number; dynamic: boolean; change: 'new' | 'changed' };
export type RedRow = Changed & { verdict: Verdict | 'file did not load' | 'could not build' };

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function changedTests(repo: string, mergeBase: string, head: string, patterns = loadConfig().tests): Changed[] {
  const read = (tree: Tree): Array<TestCall & { file: string }> =>
    [...tree.list()].filter((p) => matchesAny(p, patterns)).sort().flatMap((file) => readSource(tree.read(file) ?? '').tests.map((t) => ({ ...t, file })));
  const before = new Map<string, string[]>();
  for (const t of read(new Tree(repo, mergeBase))) before.set(t.id, [...(before.get(t.id) ?? []), squash(t.body)]);
  const out: Changed[] = [];
  for (const t of read(new Tree(repo, head))) {
    const bodies = before.get(t.id);
    const body = squash(t.body);
    if (bodies?.includes(body)) { bodies.splice(bodies.indexOf(body), 1); continue; }
    out.push({ id: t.id, file: t.file, line: t.line, dynamic: t.dynamic, change: bodies ? 'changed' : 'new' });
  }
  return out;
}

export function redOnBase(repo: string, baseRev: string, headRev: string, modules: string): { mergeBase: string; head: string; rows: RedRow[]; buildOutput: string } {
  const base = resolve(repo, baseRev);
  const head = resolve(repo, headRev);
  if (!base) throw new Error(`the base '${baseRev}' is not a commit in ${repo}`);
  if (!head) throw new Error(`the head '${headRev}' is not a commit in ${repo}`);
  const mergeBase = git(repo, ['merge-base', base, head]).trim();
  const changed = changedTests(repo, mergeBase, head);
  if (changed.length === 0) return { mergeBase, head, rows: [], buildOutput: '' };
  const tmp = tempDir('red-on-base');
  try {
    headWithBaseSrc(repo, head, mergeBase, tmp.dir);
    linkShared(modules, tmp.dir);
    const built = build(tmp.dir);
    if (!built.ok) return { mergeBase, head, rows: changed.map((c) => ({ ...c, verdict: 'could not build' })), buildOutput: built.output };
    const rows: RedRow[] = [];
    const byFile = new Map<string, Changed[]>();
    for (const c of changed) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
    for (const [file, tests] of byFile) {
      const patterns = tests.map((t) => namePattern(t.id, t.dynamic));
      const { tap } = runTests(tmp.dir, file, patterns);
      const results = readTap(tap);
      const loadFailed = results.some((r) => r.depth === 0 && !r.ok && r.name.replace(/\\/g, '/').endsWith(file));
      for (const t of tests) {
        const verdict = verdictOf(results, namePattern(t.id, t.dynamic));
        rows.push({ ...t, verdict: verdict === 'did not run' && loadFailed ? 'file did not load' : verdict });
      }
    }
    return { mergeBase, head, rows, buildOutput: '' };
  } finally {
    tmp.done();
  }
}

export function renderRed(result: { mergeBase: string; head: string; rows: RedRow[]; buildOutput: string }): string {
  const lines = [`red on base: the tests of ${result.head.slice(0, 7)} against the src/ of the merge base ${result.mergeBase.slice(0, 7)}`, ''];
  if (result.rows.length === 0) return `${lines[0]}\nno new or changed test\n`;
  lines.push('| Test | File | Change | On the base |', '|---|---|---|---|');
  const say: { [k: string]: string } = {
    red: 'red',
    'file did not load': 'red: the file did not load',
    green: 'green: not shown to fail on the base',
    skipped: 'skipped: not shown to fail on the base',
    'did not run': 'did not run: not shown to fail on the base',
    'could not build': 'could not build the base',
  };
  for (const r of result.rows) lines.push(`| ${r.id.replace(/\|/g, '\\|')} | ${r.file}:${r.line} | ${r.change} | ${say[r.verdict]} |`);
  const red = result.rows.filter((r) => r.verdict === 'red' || r.verdict === 'file did not load').length;
  lines.push('', `${red} of ${result.rows.length} new or changed tests are red on the base; each green one describes behaviour that already held, and its change says so, or it does not test the change`);
  if (result.buildOutput) lines.push('', 'the build of the base failed:', result.buildOutput.trimEnd().split('\n').slice(-20).join('\n'));
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] !== undefined && resolveMain(process.argv[1]) === import.meta.filename) {
  const argv = process.argv.slice(2);
  const opts: { [k: string]: string } = { repo: process.cwd(), base: 'main', head: 'HEAD' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]!.replace(/^--/, '');
    if (!['repo', 'base', 'head', 'modules'].includes(key) || argv[i + 1] === undefined) {
      process.stderr.write(`red on base: unknown argument '${argv[i]}'\nusage: node tests/gate/red-on-base.ts [--repo <dir>] [--base <rev>] [--head <rev>] [--modules <dir with node_modules>]\n`);
      process.exit(2);
    }
    opts[key] = argv[i + 1]!;
  }
  try {
    const repo = resolvePath(opts.repo!);
    process.stdout.write(renderRed(redOnBase(repo, opts.base!, opts.head!, resolvePath(opts.modules ?? repo))));
  } catch (error) {
    process.stderr.write(`red on base: could not run: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
