import { realpathSync as realMain } from 'node:fs';
import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, copyWorkingTree, linkShared, runTests, tempDir } from '../gate/copy.ts';
import { readTap, verdictOf, type Verdict } from '../gate/tap.ts';
import { namePattern, readSource } from '../guard/source.ts';

export type Entry = { id: string; promise: string; file: string; find: string; replace: string; killedBy: string };
export type Outcome = { entry: Entry; result: 'killed' | 'SURVIVED' | 'error'; detail: string };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIELDS = ['id', 'promise', 'file', 'find', 'replace', 'killedBy'] as const;

export function readEntries(text: string): Entry[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error('the list is not a JSON array');
  const ids = new Set<string>();
  return parsed.map((raw, i) => {
    const entry = raw as { [k: string]: unknown };
    for (const field of FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field] === '') throw new Error(`entry ${i + 1} has no ${field}`);
    }
    if (ids.has(entry.id as string)) throw new Error(`the id '${entry.id}' is used twice`);
    if (entry.find === entry.replace) throw new Error(`entry '${entry.id}' replaces its text with itself`);
    ids.add(entry.id as string);
    return entry as unknown as Entry;
  });
}

function findTest(dir: string, id: string): string | null {
  for (const file of globSync('tests/**/*.test.ts', { cwd: dir }).sort()) {
    const path = file.replace(/\\/g, '/');
    if (readSource(readFileSync(join(dir, path), 'utf8')).tests.some((t) => t.id === id || (t.dynamic && namePattern(t.id, true).test(id)))) return path;
  }
  return null;
}

function said(verdict: Verdict): string {
  return verdict === 'did not run' ? 'did not run' : `is ${verdict}`;
}

function count(text: string, find: string): number {
  return text.split(find).length - 1;
}

export function sabotage(root: string, entries: Entry[], log: (line: string) => void = () => {}): Outcome[] {
  const tmp = tempDir('sabotage');
  try {
    copyWorkingTree(root, tmp.dir);
    linkShared(root, tmp.dir);
    const clean = build(tmp.dir);
    if (!clean.ok) throw new Error(`the unbroken copy does not build:\n${clean.output.trimEnd().split('\n').slice(-20).join('\n')}`);
    const outcomes: Outcome[] = [];
    const baseline = new Map<string, Verdict>();
    for (const entry of entries) {
      const fail = (detail: string): void => { outcomes.push({ entry, result: 'error', detail }); log(`error     ${entry.id}: ${detail}`); };
      const testFile = findTest(tmp.dir, entry.killedBy);
      if (!testFile) { fail(`no test is named '${entry.killedBy}'`); continue; }
      const pattern = namePattern(entry.killedBy, false);
      if (!baseline.has(entry.killedBy)) {
        baseline.set(entry.killedBy, verdictOf(readTap(runTests(tmp.dir, testFile, [pattern]).tap), pattern));
      }
      const before = baseline.get(entry.killedBy)!;
      if (before !== 'green') { fail(`'${entry.killedBy}' ${said(before)} on the unbroken code, so its red would prove nothing`); continue; }
      const path = join(tmp.dir, entry.file);
      let original: string;
      try {
        original = readFileSync(path, 'utf8');
      } catch {
        fail(`${entry.file} does not exist`);
        continue;
      }
      const hits = count(original, entry.find);
      if (hits !== 1) { fail(`its find text occurs ${hits} times in ${entry.file}, not once`); continue; }
      writeFileSync(path, original.replace(entry.find, () => entry.replace));
      try {
        const broken = build(tmp.dir);
        if (!broken.ok) { fail(`the broken code does not build:\n${broken.output.trimEnd().split('\n').slice(-5).join('\n')}`); continue; }
        const verdict = verdictOf(readTap(runTests(tmp.dir, testFile, [pattern]).tap), pattern);
        if (verdict === 'red') { outcomes.push({ entry, result: 'killed', detail: `'${entry.killedBy}' is red` }); log(`killed    ${entry.id}`); }
        else { outcomes.push({ entry, result: 'SURVIVED', detail: `'${entry.killedBy}' ${said(verdict)} with the break in place` }); log(`SURVIVED  ${entry.id}`); }
      } finally {
        writeFileSync(path, original);
      }
    }
    return outcomes;
  } finally {
    tmp.done();
  }
}

export function renderSabotage(outcomes: Outcome[]): string {
  const lines = ['| Entry | Promise | Break | Test | Result |', '|---|---|---|---|---|'];
  for (const o of outcomes) lines.push(`| ${o.entry.id} | ${o.entry.promise} | ${o.entry.file} | ${o.entry.killedBy.replace(/\|/g, '\\|')} | ${o.result}${o.result === 'killed' ? '' : `: ${o.detail.split('\n')[0]}`} |`);
  const bad = outcomes.filter((o) => o.result !== 'killed');
  for (const o of bad) if (o.detail.includes('\n')) lines.push('', `${o.entry.id}:`, o.detail);
  lines.push('', bad.length === 0
    ? `sabotage: PASS  every one of ${outcomes.length} breaks turned its test red`
    : `sabotage: FAIL  ${bad.length} of ${outcomes.length} breaks did not turn their test red: ${bad.map((o) => o.entry.id).join(', ')}`);
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] !== undefined && realMain(process.argv[1]) === import.meta.filename) {
  const argv = process.argv.slice(2);
  let list = join(ROOT, 'tests', 'sabotage', 'list.json');
  let root = ROOT;
  const only: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if ((arg === '--list' || arg === '--root') && argv[i + 1]) {
      if (arg === '--list') list = resolvePath(argv[++i]!);
      else root = resolvePath(argv[++i]!);
      continue;
    }
    if (arg.startsWith('--')) {
      process.stderr.write(`sabotage: unknown argument '${arg}'\nusage: node tests/sabotage/run.ts [--list <file>] [--root <dir>] [<entry id>...]\n`);
      process.exit(2);
    }
    only.push(arg);
  }
  try {
    const all = readEntries(readFileSync(list, 'utf8'));
    const unknown = only.filter((id) => !all.some((e) => e.id === id));
    if (unknown.length) throw new Error(`no entry has the id ${unknown.map((id) => `'${id}'`).join(', ')}`);
    const outcomes = sabotage(root, only.length ? all.filter((e) => only.includes(e.id)) : all, (line) => process.stderr.write(`${line}\n`));
    const text = renderSabotage(outcomes);
    process.stdout.write(text);
    process.exit(outcomes.every((o) => o.result === 'killed') ? 0 : 1);
  } catch (error) {
    process.stderr.write(`sabotage: could not run: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
