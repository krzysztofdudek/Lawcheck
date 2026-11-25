import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { perPushFiles, ROOT } from './sets.ts';

export const PLAN = join(ROOT, 'tests', 'harness', 'shards.json');
export const SYSTEMS = ['linux', 'win32', 'darwin'] as const;

// cost: what each file took in a shard of that system, from its start to its end (node:test's summary of the file), so with the files that ran beside it; slots: how many files a shard runs at once there.
export interface Measured {
  from: string;
  slots: number;
  cost: Record<string, number>;
  tests: Record<string, number>;
}

export interface Plan {
  measured: Record<string, Measured>;
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

// A shard runs its files in the plan's order, as many at once as it has slots, each taking the next free slot. Its wall time is when the last slot frees.
export function wallOf(files: string[], cost: (file: string) => number, slots: number): number {
  const free = Array.from({ length: Math.max(1, slots) }, () => 0);
  for (const file of files) {
    const at = free.indexOf(Math.min(...free));
    free[at]! += cost(file);
  }
  return Math.max(...free);
}

const costOf = (ms: Record<string, number>): ((file: string) => number) => {
  const known = Object.values(ms).filter((n) => n > 0).sort((a, b) => a - b);
  const median = known.length === 0 ? 1000 : known[Math.floor(known.length / 2)]!;
  return (file) => ms[file] ?? median;
};

// Longest processing time first, over the slots of every shard: each file, slowest first, goes to the shard whose wall time it raises least, and each shard lists its files slowest first, the order it starts them in. A file with no measurement on that system counts as the median of the measured ones.
export function balance(files: string[], ms: Record<string, number>, count: number, slots = 1): string[][] {
  const cost = costOf(ms);
  const order = [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : 1));
  const shards: { files: string[]; free: number[]; total: number }[] = Array.from({ length: count }, () => ({ files: [], free: Array.from({ length: Math.max(1, slots) }, () => 0), total: 0 }));
  for (const file of order) {
    const after = (shard: { free: number[] }) => Math.max(...shard.free, Math.min(...shard.free) + cost(file));
    const best = shards.reduce((b, shard, i) => (after(shard) < after(shards[b]!) || (after(shard) === after(shards[b]!) && shard.total < shards[b]!.total) ? i : b), 0);
    const shard = shards[best]!;
    shard.files.push(file);
    shard.free[shard.free.indexOf(Math.min(...shard.free))]! += cost(file);
    shard.total += cost(file);
  }
  return shards.map((s) => s.files);
}

export function plannedWalls(plan: Plan, system: (typeof SYSTEMS)[number]): number[] {
  const measured = plan.measured[system];
  const cost = costOf(measured?.cost ?? {});
  return (plan.shards[system] ?? []).map((files) => wallOf(files, cost, measured?.slots ?? 1));
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

export interface Run {
  os: string;
  node: string;
  system: (typeof SYSTEMS)[number];
  offline?: boolean;
  pull_request?: boolean;
}

// The runs of one event of ci.yml: a pull request leaves out the runs marked "pull_request": false, and every other event runs them all.
export function runsFor(runs: Run[], event?: string): Run[] {
  return event === 'pull_request' ? runs.filter((run) => run.pull_request !== false) : runs;
}

// The matrix of ci.yml, from the plan: each run of a system in the shards the plan has for that system, so a new plan changes no line of CI.
export function matrix(plan: Plan, all: Run[], event?: string): { outputs: Record<string, unknown[]>; problems: string[] } {
  const outputs: Record<string, unknown[]> = {};
  const problems: string[] = [];
  const runs = runsFor(all, event);
  for (const run of all) if (!(SYSTEMS as readonly string[]).includes(run.system)) problems.push(`the run ${run.os} Node ${run.node} names ${run.system}, which is not one of ${SYSTEMS.join(', ')}`);
  for (const system of SYSTEMS) {
    const mine = runs.filter((run) => run.system === system);
    const count = plan.shards[system]?.length ?? 0;
    if (mine.length === 0) problems.push(event === 'pull_request' ? `no run of ${system} in a pull request` : `no run of ${system} per push`);
    if (count === 0) problems.push(`tests/harness/shards.json plans no shard for ${system}`);
    outputs[`runs_${system}`] = mine;
    outputs[`shards_${system}`] = mine.flatMap((run) => Array.from({ length: count }, (_, i) => ({ ...run, shard: i + 1, of: count })));
  }
  return { outputs, problems };
}

function recordings(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...recordings(join(dir, entry.name)));
    else if (/^meta-\d+\.json$/.test(entry.name)) out.push(join(dir, entry.name));
  }
  return out.sort();
}

// The cost of each file and the time of each top-level test on one system, from a profile the merge wrote or from the recordings of its shards (tests/harness/record.ts) anywhere under dir; a file measured in several runs, as Linux's on three Node versions, counts its longest.
export function measureShards(dir: string, system: (typeof SYSTEMS)[number]): Omit<Measured, 'from' | 'slots'> & { slots: number | undefined } {
  const cost: Record<string, number> = {};
  const tests: Record<string, number> = {};
  let slots: number | undefined;
  if (statSync(dir).isFile()) {
    const written = JSON.parse(readFileSync(dir, 'utf8')) as { system: string; slots?: number; costs?: Record<string, number>; tests: Record<string, { ms: number }> };
    if (written.system !== system) return { cost, tests, slots };
    for (const [key, t] of Object.entries(written.tests)) tests[key] = t.ms;
    return { cost: { ...written.costs }, tests, slots: written.slots };
  }
  for (const metaFile of recordings(dir)) {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { system: string; root?: string; shard: number; slots?: number };
    if (meta.system !== system) continue;
    if (meta.slots !== undefined) slots = Math.max(slots ?? 0, meta.slots);
    const events = join(dirname(metaFile), `events-${meta.shard}.jsonl`);
    if (!existsSync(events)) continue;
    for (const line of readFileSync(events, 'utf8').split('\n')) {
      if (!line) continue;
      const event = JSON.parse(line) as { type: string; data: { file?: string; name?: string; nesting?: number; duration_ms?: number; details?: { duration_ms?: number } } };
      const data = event.data;
      if (!data.file) continue;
      const file = repoPath(data.file, meta.root);
      if (event.type === 'test:summary' && data.duration_ms !== undefined) cost[file] = Math.max(cost[file] ?? 0, Math.round(data.duration_ms));
      if ((event.type !== 'test:pass' && event.type !== 'test:fail') || data.nesting !== 0 || data.name === data.file || data.name === file) continue;
      const key = `${file} > ${data.name}`;
      tests[key] = Math.max(tests[key] ?? 0, Math.round(data.details?.duration_ms ?? 0));
    }
  }
  return { cost, tests, slots };
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage = 'usage: node tests/harness/shards.ts plan [--count <system>=<n>]... [--slots <system>=<n>]... [--measured <system>=<a profile, or a folder holding the recordings of its shards>=<run>]...';
  const [command, ...rest] = process.argv.slice(2);
  const refuse = (message = usage): never => { process.stderr.write(`${message}\n`); process.exit(2); };
  if (command === 'matrix') {
    if (!(rest.length === 1 || (rest.length === 3 && rest[1] === '--event' && rest[2] !== ''))) refuse('usage: node tests/harness/shards.ts matrix <the runs of ci.yml as JSON> [--event <the event of the run>]');
    const { outputs, problems } = matrix(readPlan(), JSON.parse(rest[0]!) as Run[], rest[2]);
    if (problems.length > 0) refuse(problems.join('\n'));
    for (const [key, value] of Object.entries(outputs)) process.stdout.write(`${key}=${JSON.stringify(value)}\n`);
    process.exit(0);
  }
  if (command !== 'plan') refuse();
  const plan: Plan = existsSync(PLAN) ? readPlan() : { measured: {}, shards: {} };
  const counts: Record<string, number> = {};
  const slots: Record<string, number> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (value === undefined) refuse();
    const [system, a, b] = value!.split('=') as [(typeof SYSTEMS)[number], string?, string?];
    if (!(SYSTEMS as readonly string[]).includes(system)) refuse(`unknown system ${system}; the systems are ${SYSTEMS.join(', ')}`);
    if (flag === '--count') counts[system] = Number(a);
    else if (flag === '--slots') slots[system] = Number(a);
    else if (flag === '--measured') {
      const m = measureShards(resolve(a!), system);
      if (Object.keys(m.cost).length === 0) refuse(`${a} holds no recording of a shard on ${system}`);
      plan.measured[system] = { from: b ?? a!, slots: m.slots ?? plan.measured[system]?.slots ?? 1, cost: m.cost, tests: m.tests };
    } else refuse();
  }
  for (const system of SYSTEMS) {
    if (slots[system] !== undefined && plan.measured[system] !== undefined) plan.measured[system]!.slots = slots[system]!;
    const count = counts[system] ?? plan.shards[system]?.length ?? 1;
    plan.shards[system] = balance(perPushFiles(system), plan.measured[system]?.cost ?? {}, count, plan.measured[system]?.slots ?? 1);
  }
  writeFileSync(PLAN, `${JSON.stringify(plan, null, 2)}\n`);
  for (const system of SYSTEMS) {
    const walls = plannedWalls(plan, system);
    process.stdout.write(`${system}: ${walls.length} shards of ${plan.measured[system]?.slots ?? 1} slots, planned ${walls.map((t) => `${(t / 1000).toFixed(0)} s`).join(', ')}\n`);
  }
}
