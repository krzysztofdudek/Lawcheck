import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { changes, git, resolve, Tree, type Change } from './git.ts';
import { matchesAny, globToRegExp } from './glob.ts';
import { fencedBlocks, invariantRows, readWeakenings, RECORD_HEADER, rulings, type Record, type Row } from './markdown.ts';
import { namePattern, readSource, tokenize, type Marker } from './source.ts';
import { codeOf, readConstants, type Value } from './constants.ts';

export type Config = {
  weakenings: string;
  tests: string[];
  specs: string[];
  rulings: string;
  docs: string[];
  numbers: string;
  sabotage: string;
  runes: string;
  platformReasons: { file: string; export: string; call: string };
  shrinkOnly: string[];
  selection: { tests: { file: string; export: string }; promises: { file: string; export: string }; nightly: string[] };
  paths: { guard: string[]; ci: string[]; harness: string[]; expected: string[]; law: string[] };
  roles: { [role: string]: string };
  approvers: { [kind: string]: string[] };
  stronger: string;
  ratchets: Array<string | { file: string; lists: string[] }>;
};

export type Direction = 'higher' | 'lower' | 'fixed';

export function loadConfig(path = new URL('./config.json', import.meta.url)): Config {
  return JSON.parse(readFileSync(path, 'utf8')) as Config;
}

export const RECORD_KINDS = [
  'test-removed',
  'expected-changed',
  'docs-example-changed',
  'sabotage-changed',
  'sabotage-removed',
  'harness-changed',
  'promise-changed',
  'guard-changed',
  'ci-changed',
  'threshold-lowered',
  'ratchet-grew',
  'law-changed',
  'platform-narrowed',
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export type NeverKind = 'only-added' | 'todo-added' | 'skip-unlisted' | 'number-unclassified' | 'number-unreadable' | 'weakenings-rewritten' | 'record-invalid' | 'sabotage-guard-kept' | 'list-unreadable' | 'platform-unlisted';

const PATH_KINDS = new Set<string>(['expected-changed', 'harness-changed', 'guard-changed', 'ci-changed', 'law-changed']);
const OWNER_LIKE = new Set<string>(['promise-changed', 'guard-changed', 'ci-changed', 'threshold-lowered']);

export type Weakening = {
  kind: RecordKind | NeverKind;
  subject: string;
  state?: string;
  where: string;
  detail: string;
  testId?: string;
  promise?: string;
};

export type Finding = Weakening & {
  cleared: boolean;
  record?: Record;
  why: string[];
  needs?: string;
  needsBase?: boolean;
  approves?: string;
  anchors?: string;
};

export type Report = {
  base: string;
  mergeBase: string;
  head: string;
  findings: Finding[];
  records: Array<{ record: Record; valid: boolean; matched: boolean; why: string[] }>;
  notes: string[];
  passed: boolean;
};

// rows and findings come from the names of the tests: 'test 12' and 'S3-1' at the start of a name. Each maps to the names that carry it, so a change that removes or renames such a test changes its anchor.
type Snapshot = {
  tree: Tree;
  rows: Map<string, string[]>;
  invariants: Map<string, string[]>;
  findings: Map<string, string[]>;
  rulings: Set<string>;
  runes: string | null;
};

function group(rows: Row[], into: Map<string, string[]>): void {
  for (const row of rows) {
    const list = into.get(row.key) ?? [];
    list.push(row.text);
    into.set(row.key, list);
  }
}

function specFiles(tree: Tree, config: Config): string[] {
  return [...tree.list()].filter((p) => matchesAny(p, config.specs) && p !== config.rulings).sort();
}

function snapshot(tree: Tree, config: Config, names: string[]): Snapshot {
  const invariants = new Map<string, string[]>();
  for (const file of specFiles(tree, config)) group(invariantRows(tree.read(file) ?? ''), invariants);
  const rows = new Map<string, string[]>();
  const findings = new Map<string, string[]>();
  for (const name of [...names].sort()) {
    for (const row of leadingRows(name)) group([{ key: `row ${row}`, text: name, line: 0 }], rows);
    const finding = /^(S\d+-\d+)(?![\w-])/.exec(name)?.[1];
    if (finding) group([{ key: finding, text: name, line: 0 }], findings);
  }
  let runes: string | null = null;
  try {
    const pkg = JSON.parse(tree.read('package.json') ?? '{}') as { dependencies?: { [k: string]: string }; devDependencies?: { [k: string]: string } };
    runes = pkg.dependencies?.[config.runes] ?? pkg.devDependencies?.[config.runes] ?? null;
  } catch {
    runes = null;
  }
  return { tree, rows, invariants, findings, rulings: rulings(tree.read(config.rulings) ?? ''), runes };
}

function same(a: string[] | undefined, b: string[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function count<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return out;
}

// The test numbers a name leads with, 'test 12' or 'tests 306 and 307', as testIds of tests/harness/promises.ts reads them; the platform selection and the anchors of a removed test both read them here.
function leadingRows(name: string): Set<string> {
  const rows = /^tests? (\d+(?:(?:, | and )\d+)*)/.exec(name);
  return new Set(rows === null ? [] : rows[1]!.split(/, | and /));
}

// Older rows of tests/weakenings.md and older sabotage entries write a test number as 'row N'; the key of both spellings stays 'row N'.
function keyOf(text: string): string {
  const row = /^(?:row|test)\s+(\d+)$/i.exec(text);
  return row ? `row ${row[1]}` : String(text);
}

function shown(key: string): string {
  return key.replace(/^row /, 'test ');
}

function namedIn(id: string): Set<string> {
  const out = new Set<string>();
  for (const m of id.matchAll(/\btests?\s+(\d+(?:\s*(?:,|and|to)\s*\d+)*)/gi)) {
    for (const n of m[1]!.matchAll(/\d+/g)) out.add(`row ${n[0]}`);
  }
  for (const m of id.matchAll(/\bI-[A-Za-z0-9][\w-]*/g)) out.add(m[0]);
  for (const m of id.matchAll(/\bS\d+-\d+\b/g)) out.add(m[0]);
  return out;
}

function numbers(text: string | null, config: Config): { values: Map<string, Value>; direction: (key: string) => Direction | null } {
  const all = readConstants(text ?? '');
  const values = new Map<string, Value>();
  const directions = new Map<string, Direction>();
  const prefix = `${config.stronger}.`;
  for (const [key, value] of all) {
    if (key === config.stronger) continue;
    if (!key.startsWith(prefix)) { values.set(key, value); continue; }
    if (value.kind === 'text' && (value.value === 'higher' || value.value === 'lower' || value.value === 'fixed')) directions.set(key.slice(prefix.length), value.value);
  }
  const direction = (key: string): Direction | null => {
    const parts = key.split('.');
    for (let n = parts.length; n > 0; n--) {
      const hit = directions.get(parts.slice(0, n).join('.'));
      if (hit) return hit;
    }
    return null;
  };
  return { values, direction };
}

function describeValue(v: Value | undefined): string {
  if (!v) return 'absent';
  if (v.kind === 'number') return String(v.value);
  if (v.kind === 'list') return `[${v.items.map((s) => JSON.stringify(s)).join(', ')}]`;
  if (v.kind === 'text') return JSON.stringify(v.value);
  if (v.kind === 'records') return JSON.stringify(v.items);
  return v.text;
}

type Entry = { id: string; promise: string; file: string; find: string; replace: string; killedBy: string };

function readList(text: string | null): Entry[] | null {
  if (text === null) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as Entry[];
  } catch {
    return null;
  }
}

function platformReasons(tree: Tree, config: Config): { reasons: Set<string>; parts: Set<string>; found: boolean; wholeSkips: Array<{ file: string; test: string; platform: string }> } {
  const text = tree.read(config.platformReasons.file);
  const out = { reasons: new Set<string>(), parts: new Set<string>(), found: false, wholeSkips: [] as Array<{ file: string; test: string; platform: string }> };
  if (text === null) return out;
  const value = readConstants(text).get(config.platformReasons.export);
  if (!value) return out;
  out.found = true;
  if (value.kind === 'list') value.items.forEach((s) => out.reasons.add(s));
  if (value.kind === 'records') {
    for (const entry of value.items) {
      if (typeof entry.reason === 'string') out.reasons.add(entry.reason);
      if (typeof entry.part === 'string') out.parts.add(entry.part);
      if (entry.part === 'the whole test' && typeof entry.file === 'string' && typeof entry.test === 'string' && typeof entry.platform === 'string') out.wholeSkips.push({ file: entry.file, test: entry.test, platform: entry.platform });
    }
  }
  return out;
}

function anchorHint(kind: string, config: Config): string {
  if (kind === 'test-removed') return `the test number ('test <n>') or finding ('S<r>-<n>') that the test's name leads with, or a promise ('I-...') it names whose row this change also changes; or 'ruling <n>' of ${config.rulings}; or 'Runes <version>' that this change moves to`;
  if (kind === 'sabotage-removed') return "the entry's promise, removed in this change together with the code the entry breaks";
  if (OWNER_LIKE.has(kind) || kind === 'harness-changed' || kind === 'law-changed' || kind === 'platform-narrowed') return "anything this change really holds: a path it changes, 'test <n>' or 'I-...' it changes, 'ruling <n>', or 'Runes <version>' it moves to";
  return `'test <n>' or 'I-...' that this change adds, changes or removes; or 'ruling <n>' of ${config.rulings}; or 'Runes <version>' that this change moves to`;
}

export function judge(repo: string, baseRev: string, headRev: string, config: Config, today = new Date().toISOString().slice(0, 10)): Report {
  const base = resolve(repo, baseRev);
  const head = resolve(repo, headRev);
  if (!base) throw new Error(`the base '${baseRev}' is not a commit in ${repo}`);
  if (!head) throw new Error(`the head '${headRev}' is not a commit in ${repo}`);
  const mergeBase = git(repo, ['merge-base', base, head]).trim();
  if (!mergeBase) throw new Error(`'${baseRev}' and '${headRev}' have no merge base`);
  const before = new Tree(repo, mergeBase);
  const after = new Tree(repo, head);
  const judgeTree = new Tree(repo, base);
  const diff = changes(repo, mergeBase, head);
  const weakenings: Weakening[] = [];
  const notes: string[] = [];
  const add = (w: Weakening): void => { weakenings.push(w); };

  const testFiles = (tree: Tree): string[] => [...tree.list()].filter((p) => matchesAny(p, config.tests)).sort();
  const sources = (tree: Tree): Map<string, ReturnType<typeof readSource>> => new Map(testFiles(tree).map((f) => [f, readSource(tree.read(f) ?? '', [config.platformReasons.call])]));
  const beforeSources = sources(before);
  const afterSources = sources(after);

  const idsBefore = new Map<string, { file: string; line: number; dynamic: boolean; n: number }>();
  for (const [file, src] of beforeSources) for (const t of src.tests) {
    const known = idsBefore.get(t.id);
    if (known) known.n++;
    else idsBefore.set(t.id, { file, line: t.line, dynamic: t.dynamic, n: 1 });
  }
  const idsAfter = count([...afterSources.values()].flatMap((s) => s.tests), (t) => t.id);
  for (const [id, info] of idsBefore) {
    const left = idsAfter.get(id) ?? 0;
    if (left >= info.n) continue;
    add({ kind: 'test-removed', subject: id, where: `${info.file}:${info.line}`, detail: left === 0 ? 'removed or renamed' : `${info.n - left} of ${info.n} tests of this name removed`, testId: id });
  }

  const renamedFrom = new Map(diff.filter((c) => c.status === 'R').map((c) => [c.path, c.from]));
  const reasons = platformReasons(judgeTree, config);
  for (const [file, src] of afterSources) {
    const old = beforeSources.get(renamedFrom.get(file) ?? file);
    const had = count(old?.markers ?? [], (m) => `${m.kind}\0${m.text}`);
    const seen = new Map<string, number>();
    for (const marker of src.markers) {
      const key = `${marker.kind}\0${marker.text}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n <= (had.get(key) ?? 0)) continue;
      const where = `${file}:${marker.line}`;
      if (marker.kind === 'only') add({ kind: 'only-added', subject: marker.text, where, detail: 'only never passes: it hides every other test of the file' });
      else if (marker.kind === 'todo') add({ kind: 'todo-added', subject: marker.text, where, detail: 'todo never passes: a todo test counts as green while it fails' });
      else if (marker.kind === 'platform') {
        const part = marker.strings[0];
        if (part === undefined || !reasons.parts.has(part)) {
          add({ kind: 'skip-unlisted', subject: marker.text, where, detail: `${part === undefined ? 'the part is not a plain string' : `the part ${JSON.stringify(part)} has no entry`} in ${config.platformReasons.export} of ${config.platformReasons.file} on the base; an entry there comes first, in a change of its own` });
        }
      } else if (!isPlatformSkip(marker, reasons, config, after.read(file) ?? '')) {
        add({
          kind: 'skip-unlisted',
          subject: marker.text,
          where,
          detail: reasons.found
            ? `a skip passes only with a reason from ${config.platformReasons.call}(<part>), whose part has an entry in ${config.platformReasons.export} of ${config.platformReasons.file} on the base`
            : `a skip passes only with a platform reason of the harness's list, and the base has no ${config.platformReasons.export} in ${config.platformReasons.file}`,
        });
      }
    }
  }

  for (const change of diff) {
    const paths = change.status === 'R' ? [change.from, change.path] : [change.path];
    const label = change.status === 'R' ? `${change.from} -> ${change.path}` : change.path;
    const verb = { A: 'added', M: 'changed', D: 'deleted', R: 'renamed', T: 'changed in type' }[change.status];
    if (paths.some((p) => matchesAny(p, config.paths.guard))) add({ kind: 'guard-changed', subject: change.path, where: label, detail: `${verb}: a file of the suite guard` });
    if (paths.some((p) => matchesAny(p, config.paths.ci))) add({ kind: 'ci-changed', subject: change.path, where: label, detail: `${verb}: a CI file` });
    if (paths.some((p) => matchesAny(p, config.paths.harness) && !matchesAny(p, config.paths.expected))) add({ kind: 'harness-changed', subject: change.path, where: label, detail: `${verb}: the harness, the reporter or the runner` });
    if (paths.some((p) => matchesAny(p, config.paths.law))) add({ kind: 'law-changed', subject: change.path, where: label, detail: `${verb}: the repository's own law` });
    if (change.status !== 'A' && matchesAny(change.from, config.paths.expected)) add({ kind: 'expected-changed', subject: change.from, where: label, detail: `${verb}: an expected file` });
  }

  const scripts = (tree: Tree): { [k: string]: string } | null => {
    try {
      return (JSON.parse(tree.read('package.json') ?? '{}') as { scripts?: { [k: string]: string } }).scripts ?? {};
    } catch {
      return null;
    }
  };
  const sBefore = scripts(before);
  const sAfter = scripts(after);
  if (sBefore === null || sAfter === null) {
    if (diff.some((c) => c.path === 'package.json')) add({ kind: 'ci-changed', subject: 'package.json#scripts', where: 'package.json', detail: 'package.json does not parse, so its scripts may have changed' });
  } else {
    for (const key of new Set([...Object.keys(sBefore), ...Object.keys(sAfter)])) {
      if (sBefore[key] === sAfter[key]) continue;
      const detail = sBefore[key] === undefined ? `script added: ${JSON.stringify(sAfter[key])}` : sAfter[key] === undefined ? `script removed: ${JSON.stringify(sBefore[key])}` : `script changed: ${JSON.stringify(sBefore[key])} -> ${JSON.stringify(sAfter[key])}`;
      add({ kind: 'ci-changed', subject: `package.json#scripts.${key}`, where: 'package.json', detail });
    }
  }

  const names = (sources: Map<string, ReturnType<typeof readSource>>): string[] => [...sources.values()].flatMap((s) => s.tests.map((t) => t.id));
  const snapBefore = snapshot(before, config, names(beforeSources));
  const snapAfter = snapshot(after, config, names(afterSources));
  for (const [key, texts] of snapBefore.invariants) {
    if (same(texts, snapAfter.invariants.get(key))) continue;
    add({ kind: 'promise-changed', subject: key, where: findRowFile(before, config, key), detail: snapAfter.invariants.has(key) ? `promise reworded: ${texts[0]} -> ${snapAfter.invariants.get(key)![0]}` : `promise removed: ${texts[0]}`, promise: key });
  }

  const blockChanges = (files: string[], kind: 'promise-changed' | 'docs-example-changed'): void => {
    for (const file of files) {
      const old = fencedBlocks(before.read(file) ?? '');
      if (old.length === 0) continue;
      const kept = count(fencedBlocks(after.read(file) ?? ''), (b) => b.content);
      for (const block of old) {
        const left = kept.get(block.content) ?? 0;
        if (left > 0) { kept.set(block.content, left - 1); continue; }
        add({ kind, subject: `${file} ${block.key}`, where: `${file}:${block.line}`, detail: `an example block of ${kind === 'promise-changed' ? 'a page of promises' : 'a docs page'} changed or removed` });
      }
    }
  };
  const changedPaths = new Set(diff.filter((c) => c.status !== 'A').map((c) => c.from));
  blockChanges(specFiles(before, config).filter((f) => changedPaths.has(f)), 'promise-changed');
  const promiseFiles = new Set(specFiles(before, config));
  blockChanges([...before.list()].filter((p) => matchesAny(p, config.docs) && changedPaths.has(p) && !promiseFiles.has(p)).sort(), 'docs-example-changed');

  const numbersBefore = numbers(before.read(config.numbers), config);
  const numbersText = after.read(config.numbers);
  const numbersAfter = numbers(numbersText, config);
  const where = config.numbers;
  const shrinkOnly = (key: string): string | undefined => config.shrinkOnly.find((name) => key.startsWith(`${name}.`));
  for (const [key, value] of numbersAfter.values) {
    const dir = numbersAfter.direction(key);
    if (value.kind === 'unreadable') {
      if (dir || /^[\d\s_.+\-*/()eE]+$/.test(value.text)) add({ kind: 'number-unreadable', subject: key, where, detail: `not a plain number the guard can compare: ${value.text}` });
      continue;
    }
    if (value.kind === 'number' && !dir) add({ kind: 'number-unclassified', subject: key, where, detail: `${config.numbers} gives ${key} no direction: add it to ${config.stronger} as 'higher', 'lower' or 'fixed'` });
    if (shrinkOnly(key) && !numbersBefore.values.has(key) && numbersBefore.values.size > 0) add({ kind: 'ratchet-grew', subject: `${config.numbers}: ${key}`, where, detail: `an entry is added to ${shrinkOnly(key)}, a list that may only shrink` });
  }
  for (const [key, old] of numbersBefore.values) {
    if (old.kind !== 'number') continue;
    const now = numbersAfter.values.get(key);
    const was = numbersBefore.direction(key);
    const dir = was ?? numbersAfter.direction(key);
    if (!now) { if (!shrinkOnly(key)) add({ kind: 'threshold-lowered', subject: key, where, detail: `removed (was ${describeValue(old)})` }); continue; }
    if (now.kind !== 'number') { add({ kind: 'threshold-lowered', subject: key, where, detail: `no longer a plain number: ${describeValue(old)} -> ${describeValue(now)}` }); continue; }
    const turned = was && numbersAfter.direction(key) && numbersAfter.direction(key) !== was;
    if (turned) add({ kind: 'threshold-lowered', subject: key, where, detail: `its direction changed: ${was} -> ${numbersAfter.direction(key)} is stronger` });
    else if (dir && (dir === 'fixed' ? now.value !== old.value : dir === 'higher' ? now.value < old.value : now.value > old.value)) add({ kind: 'threshold-lowered', subject: key, where, detail: `${old.value} -> ${now.value} (${dir === 'fixed' ? 'a fixed value' : `${dir} is stronger`})` });
  }

  const numbersOld = before.read(config.numbers);
  if (numbersOld !== null && numbersText !== null && codeOf(numbersOld) !== codeOf(numbersText)) add({ kind: 'threshold-lowered', subject: config.numbers, where, detail: "its code changed: what is not a number the guard reads, such as a function that picks a budget, can raise a budget that no number shows" });

  const listBefore = readList(before.read(config.sabotage));
  const listAfter = readList(after.read(config.sabotage));
  if (listAfter === null) add({ kind: 'list-unreadable', subject: config.sabotage, where: config.sabotage, detail: 'the sabotage list is not a JSON array' });
  else if (listBefore) {
    const now = new Map(listAfter.map((e) => [e.id, e]));
    for (const entry of listBefore) {
      const kept = now.get(entry.id);
      if (kept) {
        if (JSON.stringify(kept) !== JSON.stringify(entry)) add({ kind: 'sabotage-changed', subject: entry.id, where: config.sabotage, detail: `entry changed: ${JSON.stringify(entry)} -> ${JSON.stringify(kept)}` });
        continue;
      }
      const promise = keyOf(entry.promise);
      const code = after.read(entry.file);
      const guardGone = code === null || !code.includes(entry.find);
      const promiseGone = existed(snapBefore, promise) && !existed(snapAfter, promise);
      if (!guardGone || !promiseGone) {
        const missing = [!guardGone ? `${entry.file} still holds the code it breaks` : '', !promiseGone ? `its promise ${shown(promise)} ${existed(snapAfter, promise) ? 'still exists' : 'did not exist on the merge base'}` : ''].filter(Boolean).join('; ');
        add({ kind: 'sabotage-guard-kept', subject: entry.id, where: config.sabotage, detail: `an entry of the sabotage list is removed only with the guard it breaks and with its promise: ${missing}` });
      } else {
        add({ kind: 'sabotage-removed', subject: entry.id, where: config.sabotage, detail: `removed with the code it breaks and its promise ${shown(promise)}`, promise });
      }
    }
  }

  for (const ratchet of config.ratchets) {
    if (typeof ratchet !== 'string') {
      const old = before.read(ratchet.file);
      if (old === null) continue;
      const text = after.read(ratchet.file) ?? '';
      for (const name of ratchet.lists) {
        const was = listEntries(old, name);
        if (was === null) continue;
        const now = listEntries(text, name);
        if (now === null) { add({ kind: 'list-unreadable', subject: `${ratchet.file} ${name}`, where: ratchet.file, detail: `${name} may only shrink, and ${ratchet.file} no longer declares it` }); continue; }
        const left = count(was, (e) => e);
        for (const entry of now) {
          const n = left.get(entry) ?? 0;
          if (n > 0) { left.set(entry, n - 1); continue; }
          add({ kind: 'ratchet-grew', subject: `${ratchet.file} ${name}: ${entry}`, where: ratchet.file, detail: `${name} may only shrink, and this change adds ${JSON.stringify(entry)}` });
        }
      }
      continue;
    }
    const file = ratchet;
    const old = before.read(file);
    if (old === null) continue;
    const parse = (text: string | null): unknown[] | null => {
      try { const v = JSON.parse(text ?? 'null') as unknown; return Array.isArray(v) ? v : null; } catch { return null; }
    };
    const was = parse(old);
    const now = parse(after.read(file));
    if (!was || !now) { if (!now) add({ kind: 'list-unreadable', subject: file, where: file, detail: `${file} may only shrink, and it is not a JSON array here` }); continue; }
    const left = count(was, (e) => JSON.stringify(e));
    for (const entry of now) {
      const key = JSON.stringify(entry);
      const n = left.get(key) ?? 0;
      if (n > 0) { left.set(key, n - 1); continue; }
      const named = entry as { id?: unknown; case?: unknown };
      const id = typeof named?.id === 'string' ? named.id : typeof named?.case === 'string' ? named.case : key;
      add({ kind: 'ratchet-grew', subject: `${file}: ${id}`, where: file, detail: `an entry is added to a list that may only shrink: ${key}` });
    }
  }

  const platformTests = (tree: Tree): Array<{ file: string; test: string; systems: string[] }> | null => {
    const value = readConstants(tree.read(config.selection.tests.file) ?? '').get(config.selection.tests.export);
    if (!value) return null;
    if (value.kind !== 'records') return [];
    return value.items.map((e) => ({ file: String(e.file ?? ''), test: String(e.test ?? ''), systems: Array.isArray(e.systems) ? e.systems : [] }));
  };
  const platformPromises = (tree: Tree): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    const prefix = `${config.selection.promises.export}.`;
    for (const [key, value] of readConstants(tree.read(config.selection.promises.file) ?? '')) {
      if (!key.startsWith(prefix) || !key.endsWith('.systems') || value.kind !== 'list') continue;
      out.set(key.slice(prefix.length, -'.systems'.length), value.items);
    }
    return out;
  };
  const testsBefore = platformTests(before);
  const testsAfter = platformTests(after);
  const selectionFile = config.selection.tests.file;
  const triples = (list: Array<{ file: string; test: string; systems: string[] }> | null): Set<string> => new Set((list ?? []).flatMap((e) => e.systems.map((s) => `${e.file} > ${e.test} on ${s}`)));
  const tripleAfter = triples(testsAfter);
  for (const t of triples(testsBefore)) if (!tripleAfter.has(t)) add({ kind: 'platform-narrowed', subject: t, where: selectionFile, detail: `${t.split(' on ').pop()} no longer runs this test per push: it moves to Linux only` });
  const promisesBefore = platformPromises(before);
  const promisesAfter = platformPromises(after);
  for (const [id, systems] of promisesBefore) for (const s of systems) if (!(promisesAfter.get(id) ?? []).includes(s)) add({ kind: 'platform-narrowed', subject: `promise ${id} on ${s}`, where: config.selection.promises.file, detail: `${id} is no longer a promise that behaves differently on ${s}` });
  if (testsAfter !== null) {
    const promises = new Map<string, Set<string>>();
    for (const map of [promisesBefore, promisesAfter]) for (const [id, systems] of map) promises.set(id, new Set([...(promises.get(id) ?? []), ...systems]));
    const carries = (name: string, id: string): boolean => {
      const row = /^tests? (\d+)$/.exec(id);
      if (row) return leadingRows(name).has(row[1]!);
      return new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(name);
    };
    const skips = platformReasons(after, config).wholeSkips;
    for (const [file, src] of afterSources) {
      if (matchesAny(file, config.selection.nightly)) continue;
      for (const t of src.tests) {
        for (const [id, systems] of promises) {
          if (!carries(t.id, id)) continue;
          for (const system of systems) {
            if (skips.some((skip) => skip.file === file && skip.platform === system && (skip.test === t.top.id || (t.top.dynamic && namePattern(t.top.id, true).test(skip.test))))) continue;
            const listed = testsAfter.some((e) => e.file === file && e.systems.includes(system) && (e.test === t.top.id || (t.top.dynamic && namePattern(t.top.id, true).test(e.test))));
            if (!listed) add({ kind: 'platform-unlisted', subject: `${file} > ${t.top.id} on ${system}`, where: `${file}:${t.line}`, detail: `"${t.id}" carries ${id}, which behaves differently on ${system}, and ${config.selection.tests.export} in ${selectionFile} does not run its test there per push` });
          }
        }
      }
    }
  }

  const ledgerBefore = before.read(config.weakenings);
  const ledgerAfter = after.read(config.weakenings) ?? '';
  const ledger = readWeakenings(ledgerAfter);
  let isNew: (line: number, raw: string) => boolean = () => true;
  if (ledgerBefore !== null) {
    const kept = ledgerBefore.replace(/\n+$/, '');
    if (ledgerAfter.startsWith(kept)) {
      const keptLines = kept.split('\n').length;
      isNew = (line) => line > keptLines;
    } else {
      add({ kind: 'weakenings-rewritten', subject: config.weakenings, where: config.weakenings, detail: `${config.weakenings} only grows: a line it held on the merge base was changed or removed` });
      const oldLines = new Set(ledgerBefore.split('\n').map((l) => l.trim()));
      isNew = (_line, raw) => !oldLines.has(raw.trim());
    }
  }
  if (ledgerAfter && JSON.stringify(ledger.header) !== JSON.stringify(RECORD_HEADER) && (ledgerBefore === null || readWeakenings(ledgerBefore).header === null)) {
    add({ kind: 'record-invalid', subject: config.weakenings, where: config.weakenings, detail: `its table's header must be | ${RECORD_HEADER.join(' | ')} |` });
  }
  for (const bad of ledger.malformed) if (isNew(bad.line, bad.raw)) add({ kind: 'record-invalid', subject: bad.raw.trim(), where: `${config.weakenings}:${bad.line}`, detail: `not a record: ${bad.why}` });
  const added = ledger.records.filter((r) => isNew(r.line, r.raw));

  const ownWord = (kind: string): boolean => (config.approvers[kind] ?? []).includes('owner') && !(config.approvers[kind] ?? []).some((r) => r !== 'owner');
  const stateOf = (w: Weakening): string => {
    if (w.kind === 'threshold-lowered' && w.subject === config.numbers) return after.blob(w.subject) ?? 'deleted';
    if (w.kind === 'threshold-lowered') return `${describeValue(numbersAfter.values.get(w.subject))} ${numbersAfter.direction(w.subject) ?? 'no direction'}`;
    if (w.kind === 'promise-changed') {
      const row = snapAfter.invariants.get(w.subject);
      if (w.subject.startsWith('I-')) return row ? row.join('\n') : 'removed';
      const file = w.subject.split(' ')[0]!;
      return after.blob(file) ?? 'deleted';
    }
    const script = /^package\.json#scripts\.(.+)$/.exec(w.subject);
    if (script) return JSON.stringify(sAfter?.[script[1]!] ?? null);
    return after.blob(w.subject) ?? 'deleted';
  };
  for (const w of weakenings) if (ownWord(w.kind)) w.state = stateOf(w);
  const approvalOf = (kind: string, what: string): string => approvalHash(weakenings.filter((w) => w.kind === kind && whatMatches(what, w.subject, kind)));
  const context: AnchorContext = { before: snapBefore, after: snapAfter, diff, config };
  const recordState = added.map((record) => ({
    record,
    matched: false,
    why: ownWord(record.kind) ? [`a record of ${record.kind} counts only when it is already on the base ${base.slice(0, 7)}: the owner's row lands there first, in a change of its own, and a branch never brings its own`] : validate(record, context),
  }));
  const onBase = readWeakenings(judgeTree.read(config.weakenings) ?? '').records
    .filter((record) => ownWord(record.kind))
    .map((record) => ({ record, matched: false, why: validate(record, context), fromBase: true }));

  const findings: Finding[] = weakenings.map((w) => {
    if (!(RECORD_KINDS as readonly string[]).includes(w.kind)) return { ...w, cleared: false, why: [w.detail] };
    const fits = (r: { record: Record }): boolean => r.record.kind === w.kind && whatMatches(r.record.what, w.subject, w.kind);
    const matching = [...onBase.filter(fits), ...recordState.filter(fits)];
    for (const r of matching) r.matched = true;
    const extra = (r: { record: Record }): string[] => {
      const why = fitsWeakening(r.record, w);
      if (!ownWord(w.kind) || !('fromBase' in r)) return why;
      const approved = r.record.anchor.split(/\s*;\s*/).map(parseAnchor).find((a) => a?.type === 'approves')?.key;
      const now = approvalOf(r.record.kind, r.record.what);
      if (!approved) return [...why, `it names no change it approves; for this change the anchor holds 'approves ${now}'`];
      if (approved !== now) return [...why, `it approves the change ${approved}, and this change is ${now}: an owner's record covers only the change it was made for`];
      return why;
    };
    const good = matching.find((r) => r.why.length === 0 && extra(r).length === 0);
    if (good) return { ...w, cleared: true, record: good.record, why: [] };
    const roles = config.approvers[w.kind] ?? [];
    const place = (r: { record: Record }): string => `${'fromBase' in r ? `the base's ${config.weakenings}` : config.weakenings}:${r.record.line}`;
    const why = matching.length === 0 ? [ownWord(w.kind) ? `no record of it on the base ${base.slice(0, 7)}` : 'no record of it in this change'] : matching.flatMap((r) => [...r.why, ...extra(r)].map((reason) => `the record at ${place(r)}: ${reason}`));
    return {
      ...w,
      cleared: false,
      why,
      needs: `| ${today} | ${w.subject.replace(/\|/g, '\\|')} | ${w.kind} | <why the suite may get weaker here> | <anchor>${ownWord(w.kind) ? `; approves ${approvalOf(w.kind, w.subject)}` : ''} | ${roles.map((r) => (r === 'reviewer' ? 'reviewer <the fresh reviewer agent>' : r)).join(' or ') || '<nobody may approve this kind>'} |`,
      needsBase: ownWord(w.kind),
      approves: ownWord(w.kind) ? approvalOf(w.kind, w.subject) : undefined,
      anchors: anchorHint(w.kind, config),
    };
  });

  const records = recordState.map((r) => {
    const why = !r.matched && ownWord(r.record.kind) ? validate(r.record, context, true) : r.why;
    return { record: r.record, matched: r.matched, valid: why.length === 0, why };
  });
  for (const r of records) {
    if (!r.matched && !r.valid) {
      findings.push({ kind: 'record-invalid', subject: r.record.what, where: `${config.weakenings}:${r.record.line}`, detail: r.why.join('; '), cleared: false, why: r.why });
    }
  }
  if (!reasons.found) notes.push(`the base has no ${config.platformReasons.export} in ${config.platformReasons.file}, so no new skip can pass`);
  if (numbersText === null) notes.push(`${config.numbers} does not exist on the head; no number was compared`);
  return { base, mergeBase, head, findings, records, notes, passed: findings.every((f) => f.cleared) };
}

function listEntries(text: string, name: string): string[] | null {
  const tokens = tokenize(text);
  for (let k = 0; k + 2 < tokens.length; k++) {
    const t = tokens[k]!;
    const declared = t.type === 'name' && ['const', 'let', 'var'].includes(t.value) && tokens[k + 1]?.type === 'name' && tokens[k + 1]!.value === name;
    if (!declared) continue;
    let m = k + 2;
    while (m < tokens.length && !(tokens[m]!.type === 'punct' && tokens[m]!.value === '=')) m++;
    const out: string[] = [];
    let depth = 0;
    for (let j = m + 1; j < tokens.length; j++) {
      const tok = tokens[j]!;
      if (tok.type === 'punct' && '([{'.includes(tok.value)) depth++;
      else if (tok.type === 'punct' && ')]}'.includes(tok.value)) depth--;
      else if (depth === 0 && tok.type === 'punct' && tok.value === ';') break;
      if (depth === 0 && tok.type === 'name' && ['const', 'let', 'var', 'export', 'function', 'test'].includes(tok.value)) break;
      const prev = tokens[j - 1];
      if (tok.type === 'punct' && tok.value === '{' && prev?.type === 'punct' && (prev.value === '[' || prev.value === ',')) {
        let inner = 1;
        let e = j + 1;
        while (e < tokens.length && inner > 0) {
          if (tokens[e]!.type === 'punct' && '([{'.includes(tokens[e]!.value)) inner++;
          else if (tokens[e]!.type === 'punct' && ')]}'.includes(tokens[e]!.value)) inner--;
          e++;
        }
        out.push(text.slice(tok.start, tokens[e - 1]!.end).replace(/\s+/g, ' '));
        depth--;
        j = e - 1;
        continue;
      }
      if (tok.type === 'string' || tok.type === 'template') out.push(tok.value);
    }
    return out;
  }
  return null;
}

function isPlatformSkip(marker: Marker, reasons: { reasons: Set<string> }, config: Config, text: string): boolean {
  if (marker.strings.some((s) => reasons.reasons.has(s))) return true;
  const call = config.platformReasons.call;
  if (marker.text.includes(`${call}(`)) return true;
  const id = /^[A-Za-z_$][\w$]*$/.exec(marker.text.trim())?.[0];
  return id !== undefined && new RegExp(`\\b(?:const|let)\\s+${id.replace(/\$/g, '\\$')}\\s*=\\s*${call}\\(`).test(text);
}

export function whatMatches(what: string, subject: string, kind: string): boolean {
  if (what === subject) return true;
  if (PATH_KINDS.has(kind) || kind === 'ci-changed') return globToRegExp(what).test(subject);
  return false;
}

function findRowFile(tree: Tree, config: Config, key: string): string {
  for (const file of specFiles(tree, config)) {
    const text = tree.read(file) ?? '';
    const hit = invariantRows(text).find((r) => r.key === key);
    if (hit) return `${file}:${hit.line}`;
  }
  return config.specs.join(', ');
}

type AnchorContext = { before: Snapshot; after: Snapshot; diff: Change[]; config: Config };

type Anchor = { type: 'row' | 'invariant' | 'finding' | 'ruling' | 'runes' | 'path' | 'approves'; key: string; raw: string };

export function approvalHash(items: Array<{ kind: string; subject: string; state?: string }>): string {
  const lines = items.map((w) => `${w.kind}\t${w.subject}\t${w.state ?? ''}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

export function parseAnchor(raw: string): Anchor | null {
  const text = raw.trim().replace(/^`|`$/g, '');
  let m = /^(?:row|test)\s+(\d+)$/i.exec(text);
  if (m) return { type: 'row', key: `row ${m[1]}`, raw: text };
  if (/^I-[A-Za-z0-9][\w-]*$/.test(text)) return { type: 'invariant', key: text, raw: text };
  if (/^S\d+-\d+$/.test(text)) return { type: 'finding', key: text, raw: text };
  m = /^ruling\s+(\d+)$/i.exec(text);
  if (m) return { type: 'ruling', key: m[1]!, raw: text };
  m = /^approves\s+([0-9a-f]{16})$/.exec(text);
  if (m) return { type: 'approves', key: m[1]!, raw: text };
  m = /^runes\s+v?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/i.exec(text);
  if (m) return { type: 'runes', key: m[1]!, raw: text };
  if (/^[\w.@*-]+(?:\/[\w.@*{},-]+)*(?:#[\w.*-]+)?$/.test(text) && (text.includes('/') || text.includes('.'))) return { type: 'path', key: text.split('#')[0]!, raw: text };
  return null;
}

function existed(snap: Snapshot, key: string): boolean {
  return snap.rows.has(key) || snap.invariants.has(key) || snap.findings.has(key);
}

function label(anchor: Anchor): string {
  return anchor.type === 'row' ? shown(anchor.key) : anchor.raw;
}

function anchorProblem(anchor: Anchor, ctx: AnchorContext): string | null {
  const { before, after } = ctx;
  if (anchor.type === 'approves') return null;
  if (anchor.type === 'row' || anchor.type === 'invariant' || anchor.type === 'finding') {
    const pick = (s: Snapshot): Map<string, string[]> => (anchor.type === 'row' ? s.rows : anchor.type === 'invariant' ? s.invariants : s.findings);
    const a = pick(before).get(anchor.key);
    const b = pick(after).get(anchor.key);
    const where = anchor.type === 'invariant' ? ctx.config.specs.join(', ') : 'the names of the tests';
    if (!a && !b) return `the anchor '${label(anchor)}' does not exist in ${where}`;
    if (same(a, b)) return `the anchor '${label(anchor)}' exists, but this change does not add, reword or remove it`;
    return null;
  }
  if (anchor.type === 'ruling') return after.rulings.has(anchor.key) ? null : `the anchor '${anchor.raw}' is not a ruling of ${ctx.config.rulings} ('## ${anchor.key}. ...' is not there)`;
  if (anchor.type === 'runes') {
    if (after.runes !== anchor.key) return `the anchor '${anchor.raw}' is not the Runes version of package.json (${after.runes ?? 'none'})`;
    if (before.runes === after.runes) return `the anchor '${anchor.raw}' is the Runes version already on the merge base; this change does not move to it`;
    return null;
  }
  const re = globToRegExp(anchor.key);
  return ctx.diff.some((c) => re.test(c.path) || re.test(c.from)) ? null : `the anchor '${anchor.raw}' names no path this change touches`;
}

function validate(record: Record, ctx: AnchorContext, anchorsOfAnotherChange = false): string[] {
  const why: string[] = [];
  if (!(RECORD_KINDS as readonly string[]).includes(record.kind)) {
    return [`'${record.kind}' is not a kind the guard knows (${RECORD_KINDS.join(', ')})`];
  }
  const allowed = ctx.config.approvers[record.kind] ?? [];
  const role = Object.entries(ctx.config.roles).find(([, pattern]) => new RegExp(pattern, 'i').test(record.approvedBy))?.[0];
  if (!role) why.push(`'${record.approvedBy}' names no approver the configuration knows (${Object.keys(ctx.config.roles).map((r) => (r === 'reviewer' ? 'reviewer <agent>' : r)).join(', ')})`);
  else if (!allowed.includes(role)) why.push(`${record.kind} needs the approval of ${allowed.join(' or ') || 'nobody the configuration names'}, and ${role} approved it`);
  const parts = record.anchor.split(/\s*;\s*/).filter(Boolean);
  const anchors = parts.map(parseAnchor);
  parts.forEach((p, i) => { if (!anchors[i]) why.push(`'${p}' is not an anchor (test <n>, I-..., S<r>-<n>, ruling <n>, Runes <version>, or a path)`); });
  if (!anchorsOfAnotherChange) for (const a of anchors) if (a) { const p = anchorProblem(a, ctx); if (p) why.push(p); }
  const types = anchors.filter((a): a is Anchor => a !== null).map((a) => a.type);
  const permitted = OWNER_LIKE.has(record.kind) || record.kind === 'harness-changed' || record.kind === 'law-changed' || record.kind === 'platform-narrowed' ? ['row', 'invariant', 'finding', 'ruling', 'runes', 'path'] : record.kind === 'test-removed' ? ['row', 'invariant', 'finding', 'ruling', 'runes'] : record.kind === 'sabotage-removed' ? ['row', 'invariant', 'finding'] : ['row', 'invariant', 'ruling', 'runes'];
  if (types.length > 0 && !types.some((t) => permitted.includes(t))) why.push(`${record.kind} needs an anchor of another kind: ${anchorHint(record.kind, ctx.config)}`);
  return why;
}

function fitsWeakening(record: Record, w: Weakening): string[] {
  const anchors = record.anchor.split(/\s*;\s*/).map(parseAnchor).filter((a): a is Anchor => a !== null);
  if (w.kind === 'test-removed' && w.testId !== undefined) {
    const named = namedIn(w.testId);
    const strong = anchors.filter((a) => a.type === 'ruling' || a.type === 'runes' || named.has(a.key));
    if (strong.length === 0) return [`the test's name names ${named.size ? [...named].map(shown).join(', ') : 'no test number, invariant or finding'}, and the record anchors ${anchors.map(label).join('; ') || 'nothing'}`];
  }
  if (w.kind === 'sabotage-removed' && w.promise && !anchors.some((a) => a.key === w.promise)) {
    return [`the entry's promise is ${shown(w.promise)}, and the record anchors ${anchors.map(label).join('; ') || 'nothing'}`];
  }
  return [];
}

function listed(items: string[]): string {
  return items.length <= 4 ? items.join(', ') : `${items.slice(0, 3).join(', ')} and ${items.length - 3} more`;
}

function commonDir(paths: string[]): string {
  const parts = paths.map((p) => p.split('/').slice(0, -1));
  const first = parts[0] ?? [];
  let n = 0;
  while (n < first.length && parts.every((p) => p[n] === first[n])) n++;
  return first.slice(0, n).join('/') || '.';
}

function groupRefused(refused: Finding[]): Finding[][] {
  const groups = new Map<string, Finding[]>();
  const out: Finding[][] = [];
  for (const f of refused) {
    if (!PATH_KINDS.has(f.kind)) { out.push([f]); continue; }
    const key = `${f.kind}\0${f.why.join('\0')}`;
    const group = groups.get(key);
    if (group) group.push(f);
    else { const g = [f]; groups.set(key, g); out.push(g); }
  }
  return out;
}

export function render(report: Report): string {
  const short = (s: string): string => s.slice(0, 7);
  const refused = report.findings.filter((f) => !f.cleared);
  const cleared = report.findings.filter((f) => f.cleared);
  const out: string[] = [];
  const range = `${short(report.mergeBase)}..${short(report.head)}, judged by the guard of ${short(report.base)}`;
  const byRecord = new Map<string, Finding[]>();
  for (const f of cleared) byRecord.set(f.record!.raw, [...(byRecord.get(f.record!.raw) ?? []), f]);
  for (const [raw, list] of byRecord) {
    const first = list[0]!;
    out.push(`weaker   ${first.kind}  ${list.length === 1 ? first.subject : `${list.length} paths: ${listed(list.map((f) => f.subject))}`}`, `record   ${raw.trim()}`, '');
  }
  for (const group of groupRefused(refused)) {
    const f = group[0]!;
    if (group.length === 1) out.push(`REFUSED  ${f.kind}  ${f.subject}`, `where    ${f.where}`, `what     ${f.detail}`);
    else out.push(`REFUSED  ${f.kind}  ${group.length} paths under ${commonDir(group.map((g) => g.subject))}`, `where    ${listed(group.map((g) => g.where))}`, `what     ${[...new Set(group.map((g) => g.detail))].join('; ')}`);
    for (const why of f.why) if (why !== f.detail) out.push(`why      ${why}`);
    const needs = group.length === 1 ? f.needs : f.needs?.replace(` ${f.subject.replace(/\|/g, '\\|')} `, ` ${commonDir(group.map((g) => g.subject))}/** `).replace(/approves [0-9a-f]{16}/, `approves ${approvalHash(group)}`);
    if (needs) out.push(f.needsBase ? 'needs    the owner\'s row in tests/weakenings.md on the base, landed there first in a change of its own:' : 'needs    a row added to tests/weakenings.md in this change:', `         ${needs}`, `anchor   ${f.anchors}`);
    else out.push('needs    nothing passes it: undo it');
    out.push('');
  }
  for (const r of report.records) if (!r.matched && r.valid) out.push(`record   ${r.record.raw.trim()}`, `         (the guard found no weakening of this kind and subject; the record stands for one it cannot see)`, '');
  for (const note of report.notes) out.push(`note     ${note}`);
  if (report.notes.length) out.push('');
  out.push(report.passed
    ? `suite guard: PASS  ${cleared.length === 0 ? 'no weakening' : `${cleared.length} weakening${cleared.length === 1 ? '' : 's'}, each with its record`} (${range})`
    : `suite guard: FAIL  ${refused.length} weakening${refused.length === 1 ? '' : 's'} without a valid record (${range})`);
  return `${out.join('\n')}\n`;
}
