import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_TESTS, perPushFiles, perPushTests, ROOT } from './sets.ts';

export const PLAN = join(ROOT, 'tests', 'harness', 'shards.json');
export const SYSTEMS = ['linux', 'win32', 'darwin'] as const;

export interface Plan {
  measured: Record<string, { from: string; ms: Record<string, number>; tests?: Record<string, number> }>;
  shards: Record<string, string[][]>;
}

export function readPlan(path = PLAN): Plan {
  return JSON.parse(readFileSync(path, 'utf8')) as Plan;
}

const slashed = (path: string): string => path.split('\\').join('/');

// A shard may have run on another system than the one reading its recording, so its root is compared as text, without case where it has a drive letter.
export function repoPath(file: string, root: string | undefined): string {
  const path = slashed(file.startsWith('file:') ? decodeURIComponent(new URL(file).pathname).replace(/^\/(?=[A-Za-z]:)/, '') : file);
  if (root === undefined) {
    const at = path.lastIndexOf('/tests/');
    return at === -1 ? slashed(relative(ROOT, path)) : path.slice(at + 1);
  }
  const base = slashed(root).replace(/\/+$/, '');
  const fold = /^[A-Za-z]:/.test(base) ? (text: string) => text.toLowerCase() : (text: string) => text;
  return fold(path).startsWith(`${fold(base)}/`) ? path.slice(base.length + 1) : path;
}

// Longest processing time first: each file, slowest first, goes to the shard with the least measured time so far. A file with no measurement on that system counts as the median of the measured ones.
export function balance(files: string[], ms: Record<string, number>, count: number): string[][] {
  const known = Object.values(ms).filter((n) => n > 0).sort((a, b) => a - b);
  const median = known.length === 0 ? 1000 : known[Math.floor(known.length / 2)]!;
  const cost = (file: string): number => ms[file] ?? median;
  const order = [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : 1));
  const shards: { files: string[]; total: number }[] = Array.from({ length: count }, () => ({ files: [], total: 0 }));
  for (const file of order) {
    const lightest = shards.reduce((best, shard, i) => (shard.total < shards[best]!.total ? i : best), 0);
    shards[lightest]!.files.push(file);
    shards[lightest]!.total += cost(file);
  }
  return shards.map((s) => s.files.sort());
}

export function planProblems(plan: Plan, filesOf: (system: (typeof SYSTEMS)[number]) => string[] = perPushFiles): string[] {
  const problems: string[] = [];
  for (const system of SYSTEMS) {
    const files = filesOf(system);
    const shards = plan.shards[system];
    if (!shards || shards.length === 0) { problems.push(`${system}: tests/harness/shards.json plans no shard`); continue; }
    const seen = new Map<string, number[]>();
    shards.forEach((list, i) => { for (const file of list) seen.set(file, [...(seen.get(file) ?? []), i + 1]); });
    for (const file of files) if (!seen.has(file)) problems.push(`${system}: ${file} is in no shard`);
    for (const [file, where] of seen) {
      if (where.length > 1) problems.push(`${system}: ${file} is in shards ${where.join(' and ')}`);
      if (!files.includes(file)) problems.push(`${system}: shard ${where[0]} names ${file}, which is not a test file of the per-push set of ${system}`);
    }
    shards.forEach((list, i) => { if (list.length === 0) problems.push(`${system}: shard ${i + 1} holds no file`); });
  }
  return problems;
}

// The measured time of a file is the sum of the durations node:test reports for its top-level tests, read from the recordings of one CI run (tests/harness/record.ts).
export function measure(dir: string): Record<string, number> {
  return measureTests(dir).files;
}

export function measureTests(dir: string): { files: Record<string, number>; tests: Record<string, number> } {
  const ms: Record<string, number> = {};
  const tests: Record<string, number> = {};
  for (const name of readdirSync(dir).filter((n) => n.startsWith('events-') && n.endsWith('.jsonl'))) {
    const metaFile = join(dir, name.replace(/^events-/, 'meta-').replace(/\.jsonl$/, '.json'));
    const root = existsSync(metaFile) ? (JSON.parse(readFileSync(metaFile, 'utf8')) as { root?: string }).root : undefined;
    const inRepo = (file: string): string => repoPath(file, root);
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (!line) continue;
      const event = JSON.parse(line) as { type: string; data: { file?: string; name?: string; nesting?: number; details?: { duration_ms?: number } } };
      const data = event.data;
      if ((event.type !== 'test:pass' && event.type !== 'test:fail') || data.nesting !== 0 || !data.file) continue;
      const file = inRepo(data.file);
      if (data.name === data.file || data.name === file) continue;
      const took = Math.round(data.details?.duration_ms ?? 0);
      ms[file] = (ms[file] ?? 0) + took;
      tests[`${file} > ${data.name}`] = (tests[`${file} > ${data.name}`] ?? 0) + took;
    }
  }
  return { files: ms, tests };
}

// What a file costs in a system's shard: its selected tests on Windows and macOS, all of it on Linux.
export function costs(system: (typeof SYSTEMS)[number], files: string[], measured: Plan['measured'][string] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const selected = perPushTests(system, files);
  for (const file of files) {
    if (selected === null || measured?.tests === undefined) { if (measured?.ms[file] !== undefined) out[file] = measured.ms[file]!; continue; }
    const names = PLATFORM_TESTS.filter((t) => t.file === file && t.systems.includes(system as 'win32' | 'darwin')).map((t) => t.test);
    const known = names.map((n) => measured.tests![`${file} > ${n}`]).filter((n): n is number => n !== undefined);
    if (known.length > 0) out[file] = known.reduce((a, b) => a + b, 0);
  }
  return out;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage = 'usage: node tests/harness/shards.ts plan [--count <system>=<n>]... [--measured <system>=<dir of recordings>=<run>]...';
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'plan') { process.stderr.write(`${usage}\n`); process.exit(2); }
  const plan: Plan = existsSync(PLAN) ? readPlan() : { measured: {}, shards: {} };
  const counts: Record<string, number> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (value === undefined) { process.stderr.write(`${usage}\n`); process.exit(2); }
    const [system, a, b] = value.split('=');
    if (!(SYSTEMS as readonly string[]).includes(system!)) { process.stderr.write(`unknown system ${system}; the systems are ${SYSTEMS.join(', ')}\n`); process.exit(2); }
    if (flag === '--count') counts[system!] = Number(a);
    else if (flag === '--measured') { const m = measureTests(resolve(a!)); plan.measured[system!] = { from: b ?? a!, ms: m.files, tests: m.tests }; }
    else { process.stderr.write(`${usage}\n`); process.exit(2); }
  }
  for (const system of SYSTEMS) {
    const count = counts[system] ?? plan.shards[system]?.length ?? 1;
    const files = perPushFiles(system);
    plan.shards[system] = balance(files, costs(system, files, plan.measured[system]), count);
  }
  writeFileSync(PLAN, `${JSON.stringify(plan, null, 2)}\n`);
  for (const system of SYSTEMS) {
    const ms = costs(system, perPushFiles(system), plan.measured[system]);
    const totals = plan.shards[system]!.map((list) => list.reduce((sum, f) => sum + (ms[f] ?? 0), 0));
    process.stdout.write(`${system}: ${totals.length} shards, measured ${totals.map((t) => `${(t / 1000).toFixed(0)} s`).join(', ')}\n`);
  }
}
