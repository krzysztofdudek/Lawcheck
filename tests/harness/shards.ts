import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { perPushFiles, ROOT } from './sets.ts';

export const PLAN = join(ROOT, 'tests', 'harness', 'shards.json');
export const SYSTEMS = ['linux', 'win32', 'darwin'] as const;

export interface Plan {
  measured: Record<string, { from: string; ms: Record<string, number> }>;
  shards: Record<string, string[][]>;
}

export function readPlan(path = PLAN): Plan {
  return JSON.parse(readFileSync(path, 'utf8')) as Plan;
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
  const ms: Record<string, number> = {};
  for (const name of readdirSync(dir).filter((n) => n.startsWith('events-') && n.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (!line) continue;
      const event = JSON.parse(line) as { type: string; data: { file?: string; name?: string; nesting?: number; details?: { duration_ms?: number } } };
      const data = event.data;
      if ((event.type !== 'test:pass' && event.type !== 'test:fail') || data.nesting !== 0 || !data.file) continue;
      const file = relative(ROOT, data.file.startsWith('file:') ? fileURLToPath(data.file) : data.file).split('\\').join('/');
      if (data.name === data.file || data.name === file) continue;
      ms[file] = (ms[file] ?? 0) + Math.round(data.details?.duration_ms ?? 0);
    }
  }
  return ms;
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
    else if (flag === '--measured') plan.measured[system!] = { from: b ?? a!, ms: measure(resolve(a!)) };
    else { process.stderr.write(`${usage}\n`); process.exit(2); }
  }
  for (const system of SYSTEMS) {
    const count = counts[system] ?? plan.shards[system]?.length ?? 1;
    plan.shards[system] = balance(perPushFiles(system), plan.measured[system]?.ms ?? {}, count);
  }
  writeFileSync(PLAN, `${JSON.stringify(plan, null, 2)}\n`);
  for (const system of SYSTEMS) {
    const ms = plan.measured[system]?.ms ?? {};
    const totals = plan.shards[system]!.map((list) => list.reduce((sum, f) => sum + (ms[f] ?? 0), 0));
    process.stdout.write(`${system}: ${totals.length} shards, measured ${totals.map((t) => `${(t / 1000).toFixed(0)} s`).join(', ')}\n`);
  }
}
