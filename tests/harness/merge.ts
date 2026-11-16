import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMIT_TARGET_MS } from '../numbers.ts';
import { PLATFORM_TESTS, perPushFiles, perPushTests, ROOT, type System } from './sets.ts';
import { readPlan, type Plan } from './shards.ts';

export interface Meta { system: string; node: string; root?: string; shard: number; of: number; files: string[]; started: number; ended: number; status: number }
export type Event = { type: string; data: { file?: string; name?: string; nesting?: number; skip?: unknown; todo?: unknown; details?: { type?: string; duration_ms?: number; error?: { failureType?: string } } } };
export interface Shard { meta: Meta; events: Event[] }

const rel = (file: string): string => relative(ROOT, file.startsWith('file:') ? fileURLToPath(file) : file).split('\\').join('/');

export function readShards(dir: string): { shards: Shard[]; problems: string[] } {
  const shards: Shard[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) return { shards, problems: [`no recordings in ${dir}`] };
  for (const name of readdirSync(dir).filter((n) => /^meta-\d+\.json$/.test(n)).sort()) {
    const meta = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Meta;
    const events = join(dir, `events-${meta.shard}.jsonl`);
    if (!existsSync(events)) { problems.push(`shard ${meta.shard} wrote no events`); continue; }
    shards.push({ meta, events: readFileSync(events, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Event) });
  }
  return { shards, problems };
}

function ranFiles(events: Event[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if ((e.type === 'test:pass' || e.type === 'test:fail') && e.data.file) out.add(rel(e.data.file));
  return out;
}

export function failedTests(events: Event[]): number {
  let n = 0;
  for (const e of events) {
    if (e.type !== 'test:fail') continue;
    if (e.data.details?.type === 'suite' && e.data.details.error?.failureType === 'subtestsFailed') continue;
    if (e.data.nesting === 0 || e.data.details?.type === 'suite') n++;
  }
  return n;
}

// What makes the shards of one system one run: every planned shard reported, each with the plan's count, and the files they ran are the commit set, each once.
export function mergeProblems(system: string, plan: Plan, shards: Shard[], files: string[], selected: { file: string; test: string }[] | null = null): string[] {
  const problems: string[] = [];
  const planned = plan.shards[system] ?? [];
  const count = planned.length;
  if (count === 0) problems.push(`tests/harness/shards.json plans no shard for ${system}`);
  const byIndex = new Map<number, Shard[]>();
  for (const s of shards) byIndex.set(s.meta.shard, [...(byIndex.get(s.meta.shard) ?? []), s]);
  for (let i = 1; i <= count; i++) {
    const got = byIndex.get(i) ?? [];
    if (got.length === 0) problems.push(`shard ${i} of ${count} on ${system} did not report: it was cancelled, skipped or never ran`);
    if (got.length > 1) problems.push(`shard ${i} of ${count} on ${system} reported ${got.length} times`);
  }
  for (const s of shards) {
    if (s.meta.system !== system) problems.push(`shard ${s.meta.shard} ran on ${s.meta.system}, not ${system}`);
    if (s.meta.of !== count) problems.push(`shard ${s.meta.shard} ran as one of ${s.meta.of}, and the plan has ${count} for ${system}`);
    if (s.meta.shard > count || s.meta.shard < 1) problems.push(`shard ${s.meta.shard} is not a shard of the plan for ${system}`);
    if (s.meta.status !== 0) problems.push(`shard ${s.meta.shard} of ${count} on ${system} failed (exit ${s.meta.status})`);
  }
  const where = new Map<string, number[]>();
  for (const s of shards) for (const file of ranFiles(s.events)) where.set(file, [...(where.get(file) ?? []), s.meta.shard]);
  for (const s of shards) for (const file of s.meta.files) if (!ranFiles(s.events).has(file)) problems.push(`${file} was planned for shard ${s.meta.shard} and reported no test`);
  for (const file of files) if (!where.has(file)) problems.push(`${file} ran in no shard on ${system}`);
  if (selected !== null) {
    const ran = new Map<string, number>();
    for (const s of shards) for (const e of s.events) {
      if ((e.type !== 'test:pass' && e.type !== 'test:fail') || e.data.nesting !== 0 || !e.data.file) continue;
      const file = rel(e.data.file);
      if (e.data.name === e.data.file || e.data.name === file) continue;
      const key = `${file} > ${e.data.name}`;
      ran.set(key, (ran.get(key) ?? 0) + 1);
    }
    const wanted = new Set(selected.map((t) => `${t.file} > ${t.test}`));
    for (const key of wanted) {
      const n = ran.get(key) ?? 0;
      if (n === 0) problems.push(`${key} is selected for ${system} and did not run`);
      if (n > 1) problems.push(`${key} ran ${n} times on ${system}`);
    }
    for (const key of ran.keys()) if (!wanted.has(key)) problems.push(`${key} ran on ${system}, and PLATFORM_TESTS does not select it there`);
  }
  for (const [file, in_] of where) {
    if (in_.length > 1) problems.push(`${file} ran in shards ${in_.join(' and ')} on ${system}`);
    if (!files.includes(file)) problems.push(`${file} ran in shard ${in_[0]} on ${system}, and it is not a test file of the per-push set of ${system}`);
  }
  return problems;
}

async function* replay(events: Event[]): AsyncGenerator<Event> {
  for (const e of events) yield e;
}

export async function judge(dir: string, system = process.platform as System): Promise<{ text: string; failed: boolean }> {
  const { shards, problems: read } = readShards(dir);
  const ordered = [...shards].sort((a, b) => a.meta.shard - b.meta.shard);
  const files = perPushFiles(system);
  const selected = perPushTests(system, files) === null ? null : PLATFORM_TESTS.filter((t) => t.systems.includes(system as 'win32' | 'darwin') && files.includes(t.file)).map((t) => ({ file: t.file, test: t.test }));
  const problems = [...read, ...mergeProblems(system, readPlan(), ordered, files, selected)];
  const events = ordered.flatMap((s) => s.events);
  const spent = ordered.reduce((sum, s) => sum + (s.meta.ended - s.meta.started), 0);
  const wall = ordered.length === 0 ? 0 : Math.max(...ordered.map((s) => s.meta.ended)) - Math.min(...ordered.map((s) => s.meta.started));
  const lines = [`the commit set on ${system} in ${ordered.length} shards: ${ordered.map((s) => `${s.meta.shard}: ${s.meta.files.length} files in ${((s.meta.ended - s.meta.started) / 1000).toFixed(0)} s`).join(', ')}; ${(spent / 1000).toFixed(0)} s of tests, ${(wall / 1000).toFixed(0)} s from the first start to the last end`];
  const env = { LAWCHECK_STARTED: process.env.LAWCHECK_STARTED, LAWCHECK_TARGET_MS: process.env.LAWCHECK_TARGET_MS, LAWCHECK_SPEED: process.env.LAWCHECK_SPEED, LAWCHECK_TIE: process.env.LAWCHECK_TIE };
  process.env.LAWCHECK_STARTED = String(Date.now() - spent);
  process.env.LAWCHECK_TARGET_MS = String(COMMIT_TARGET_MS);
  process.env.LAWCHECK_SPEED = 'commit';
  process.env.LAWCHECK_TIE = '1';
  const before = process.exitCode;
  process.exitCode = 0;
  let judged = '';
  try {
    const { default: reporter } = await import('./reporter.ts');
    for await (const chunk of reporter(replay(events))) judged += chunk;
  } finally {
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const reporterFailed = Number(process.exitCode ?? 0) !== 0;
  process.exitCode = before;
  lines.push(judged.trimEnd());
  for (const p of problems) lines.push('', 'RED      the shards of this run are not one whole run', `got      ${p}`);
  const failed = problems.length > 0 || failedTests(events) > 0 || reporterFailed;
  lines.push('', `${failed ? 'FAIL' : 'PASS'}  the commit set on ${system}, judged as one run of ${ordered.length} shards`);
  return { text: `${lines.join('\n')}\n`, failed };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (dir === undefined || process.argv.length > 3) {
    process.stderr.write('usage: node tests/harness/merge.ts <folder holding meta-<i>.json and events-<i>.jsonl of every shard>\n');
    process.exit(2);
  }
  const { text, failed } = await judge(resolve(dir));
  process.stdout.write(text);
  process.exit(failed ? 1 : 0);
}
