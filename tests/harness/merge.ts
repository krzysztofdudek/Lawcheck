import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMIT_TARGET_MS } from '../numbers.ts';
import { judgeRun } from './reporter.ts';
import { clearedAlone } from './alone.ts';
import { PLATFORM_TESTS, perPushFiles, perPushTests, ROOT, type System } from './sets.ts';
import { readPlan, repoPath, SYSTEMS, type Plan } from './shards.ts';
import { PLATFORM_SKIPS } from './skips.ts';

export interface Meta { system: string; node: string; root?: string; slots?: number; shard: number; of: number; files: string[]; started: number; ended: number; status: number }
export type Event = { type: string; data: { file?: string; name?: string; nesting?: number; skip?: unknown; todo?: unknown; duration_ms?: number; details?: { type?: string; duration_ms?: number; error?: { failureType?: string } } } };
export interface Shard { meta: Meta; events: Event[] }

// The files of a shard's events, as paths of this checkout: the reporter and the merge then read them the same, whichever system recorded them.
function inCheckout(events: Event[], root: string | undefined): Event[] {
  return events.map((e) => (e.data?.file === undefined ? e : { ...e, data: { ...e.data, file: join(ROOT, repoPath(e.data.file, root)) } }));
}

const rel = (file: string): string => repoPath(file, ROOT);

export function readShards(dir: string): { shards: Shard[]; problems: string[] } {
  const shards: Shard[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) return { shards, problems: [`no recordings in ${dir}`] };
  for (const name of readdirSync(dir).filter((n) => /^meta-\d+\.json$/.test(n)).sort()) {
    const meta = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Meta;
    const events = join(dir, `events-${meta.shard}.jsonl`);
    if (!existsSync(events)) { problems.push(`shard ${meta.shard} wrote no events`); continue; }
    shards.push({ meta, events: inCheckout(readFileSync(events, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Event), meta.root) });
  }
  return { shards, problems };
}

function ranFiles(events: Event[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if ((e.type === 'test:pass' || e.type === 'test:fail') && e.data.file) out.add(rel(e.data.file));
  return out;
}

export function failedTests(events: Event[]): number {
  const cleared = clearedAlone(events);
  let n = 0;
  for (const e of events) {
    if (e.type !== 'test:fail') continue;
    if (e.data.details?.type === 'suite' && e.data.details.error?.failureType === 'subtestsFailed') continue;
    if (cleared.has(`${e.data.file}\0${e.data.name}`)) continue;
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
    const notRun = new Map<string, string>();
    for (const s of shards) for (const e of s.events) {
      if ((e.type !== 'test:pass' && e.type !== 'test:fail') || e.data.nesting !== 0 || !e.data.file) continue;
      const file = rel(e.data.file);
      if (e.data.name === e.data.file || e.data.name === file) continue;
      const key = `${file} > ${e.data.name}`;
      ran.set(key, (ran.get(key) ?? 0) + 1);
      if (e.data.skip !== undefined) notRun.set(key, 'skipped');
      else if (e.data.todo !== undefined) notRun.set(key, 'marked todo');
    }
    const excused = (t: { file: string; test: string }) => PLATFORM_SKIPS.some((skip) => skip.file === t.file && skip.test === t.test && skip.part === 'the whole test' && skip.platform === system);
    for (const t of selected) {
      const key = `${t.file} > ${t.test}`;
      const n = ran.get(key) ?? 0;
      if (n === 0) problems.push(`${key} is selected for ${system} and did not run`);
      else if (notRun.has(key) && !excused(t)) problems.push(`${key} is selected for ${system} and was ${notRun.get(key)}, so it did not run, and PLATFORM_SKIPS does not excuse it there`);
      if (n > 1) problems.push(`${key} ran ${n} times on ${system}`);
    }
    const wanted = new Set(selected.map((t) => `${t.file} > ${t.test}`));
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

// A system's run takes its wall time, from the first shard's start to the last one's end, as the shards run side by side; the summed time is what the shards spent together.
export function times(shards: Shard[]): { wall: number; summed: number; slowest: { shard: number; ms: number } | null } {
  if (shards.length === 0) return { wall: 0, summed: 0, slowest: null };
  const took = shards.map((s) => ({ shard: s.meta.shard, ms: s.meta.ended - s.meta.started }));
  return {
    wall: Math.max(...shards.map((s) => s.meta.ended)) - Math.min(...shards.map((s) => s.meta.started)),
    summed: took.reduce((sum, t) => sum + t.ms, 0),
    slowest: took.reduce((a, b) => (b.ms > a.ms ? b : a)),
  };
}

export function profile(system: string, shards: Shard[], sinceRun: number | null = null): { system: string; node: string; slots: number | null; wall_ms: number; summed_ms: number; run_ms: number | null; shards: { shard: number; files: number; started: number; ended: number }[]; costs: Record<string, number>; files: Record<string, number>; tests: Record<string, { file: string; ms: number; shard: number }> } {
  const files: Record<string, number> = {};
  const costs: Record<string, number> = {};
  const tests: Record<string, { file: string; ms: number; shard: number }> = {};
  for (const s of shards) for (const e of s.events) {
    if (e.type === 'test:summary' && e.data.file && e.data.duration_ms !== undefined) costs[rel(e.data.file)] = Math.round(e.data.duration_ms);
    if ((e.type !== 'test:pass' && e.type !== 'test:fail') || e.data.nesting !== 0 || !e.data.file) continue;
    const file = rel(e.data.file);
    if (e.data.name === e.data.file || e.data.name === file) continue;
    const ms = Math.round(e.data.details?.duration_ms ?? 0);
    files[file] = (files[file] ?? 0) + ms;
    tests[`${file} > ${e.data.name}`] = { file, ms, shard: s.meta.shard };
  }
  const { wall, summed } = times(shards);
  const timed = [...shards].sort((a, b) => a.meta.shard - b.meta.shard).map((s) => ({ shard: s.meta.shard, files: s.meta.files.length, started: s.meta.started, ended: s.meta.ended }));
  return { system, node: shards[0]?.meta.node ?? '', slots: shards[0]?.meta.slots ?? null, wall_ms: wall, summed_ms: summed, run_ms: sinceRun, shards: timed, costs, files, tests };
}

export type Judge = typeof judgeRun;

// The run-time tie of decision 79 (tests/contract/tie.ts) checks the whole commit set, so only the merged run of a system that runs all of it per push is judged with it; the selection of Windows and macOS, and any single shard, would read as tests gone missing.
export function tied(system: System, files: string[]): boolean {
  return perPushTests(system, files) === null;
}

// One system's shards judged as one run: red when the shards are not one whole run, a test failed, or the reporter judges the merged events red, whatever made it so.
export async function judgeShards(system: System, plan: Plan, shards: Shard[], files: string[], verdict: Judge = judgeRun, unread: string[] = []): Promise<{ text: string; failed: boolean }> {
  const ordered = [...shards].sort((a, b) => a.meta.shard - b.meta.shard);
  const selected = perPushTests(system, files) === null ? null : PLATFORM_TESTS.filter((t) => t.systems.includes(system as 'win32' | 'darwin') && files.includes(t.file)).map((t) => ({ file: t.file, test: t.test }));
  const problems = [...unread, ...mergeProblems(system, plan, ordered, files, selected)];
  const events = ordered.flatMap((s) => s.events);
  const { wall, summed } = times(ordered);
  const lines = [`the commit set on ${system} in ${ordered.length} shards: ${ordered.map((s) => `${s.meta.shard}: ${s.meta.files.length} files in ${((s.meta.ended - s.meta.started) / 1000).toFixed(0)} s`).join(', ')}; ${(wall / 1000).toFixed(0)} s of wall time from the first shard's start to the last one's end, ${(summed / 1000).toFixed(0)} s summed over the shards`];
  const env = { LAWCHECK_SPEED: process.env.LAWCHECK_SPEED, LAWCHECK_TIE: process.env.LAWCHECK_TIE };
  process.env.LAWCHECK_SPEED = 'commit';
  if (tied(system, files)) process.env.LAWCHECK_TIE = '1';
  else delete process.env.LAWCHECK_TIE;
  let judged: Awaited<ReturnType<Judge>>;
  try {
    judged = await verdict(replay(events), { system, started: Date.now() - wall, target: COMMIT_TARGET_MS });
  } finally {
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  lines.push(judged.text.trimEnd());
  for (const p of problems) lines.push('', 'RED      the shards of this run are not one whole run', `got      ${p}`);
  const failed = problems.length > 0 || failedTests(events) > 0 || judged.red;
  lines.push('', `${failed ? 'FAIL' : 'PASS'}  the commit set on ${system}, judged as one run of ${ordered.length} shards`);
  return { text: `${lines.join('\n')}\n`, failed };
}

const startUnread = (wall: number): string => `The start of the run could not be read, so only the wall time of the shards is given: ${seconds(wall)} s from the first shard's start to the last one's end.`;

export function summary(system: string, shards: Shard[], failed: boolean, sinceRun: number | null | undefined = undefined): string {
  const { wall, summed, slowest } = times(shards);
  const node = shards[0]?.meta.node ?? '';
  const sinceStart = sinceRun === undefined ? '' : sinceRun === null ? ` ${startUnread(wall)}` : ` ${seconds(sinceRun)} s from the start of the run to this verdict, the build, the setup and the merge included.`;
  return `### The commit set on ${system}${node === '' ? '' : `, Node ${node}`}: ${failed ? 'FAIL' : 'PASS'}\n\n${seconds(wall)} s of wall time, from the first shard's start to the last one's end; ${seconds(summed)} s summed over ${shards.length} shards${slowest === null ? '' : `; the slowest, shard ${slowest.shard}, took ${seconds(slowest.ms)} s`}.${sinceStart}\n\n`;
}

const seconds = (ms: number): string => (ms / 1000).toFixed(0);

// GitHub gives the start of a run as an ISO timestamp (run_started_at). Anything else, an empty value included, is no start.
export function parseRunStarted(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

// runStarted is undefined when no start was asked for, and null when it was asked for and could not be read: the verdict is the tests' either way.
export async function judge(dir: string, system: System, out: { profile?: string; summary?: string; runStarted?: number | null; now?: () => number } = {}): Promise<{ text: string; failed: boolean }> {
  const { shards, problems } = readShards(dir);
  const judged = await judgeShards(system, readPlan(), shards, perPushFiles(system), judgeRun, problems);
  const sinceRun = out.runStarted === undefined || out.runStarted === null ? null : (out.now ?? Date.now)() - out.runStarted;
  const asked = out.runStarted === undefined ? undefined : sinceRun;
  if (out.profile !== undefined) writeFileSync(out.profile, `${JSON.stringify(profile(system, shards, sinceRun), null, 2)}\n`);
  if (out.summary !== undefined) appendFileSync(out.summary, summary(system, shards, judged.failed, asked));
  const text = asked === undefined ? judged.text : sinceRun === null ? `${judged.text}${startUnread(times(shards).wall)}\n` : `${judged.text}${seconds(sinceRun)} s from the start of the run to this verdict, against ${seconds(times(shards).wall)} s of wall time of the shards\n`;
  return { text, failed: judged.failed };
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage = 'usage: node tests/harness/merge.ts <folder holding meta-<i>.json and events-<i>.jsonl of every shard> --system <linux|win32|darwin> [--profile <file>] [--summary <file>] [--run-started <run_started_at of the run, as GitHub gives it>]\n';
  const [dir, ...rest] = process.argv.slice(2);
  const options: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i]!, rest[i + 1]];
    if (!['--system', '--profile', '--summary', '--run-started'].includes(flag) || value === undefined || options[flag] !== undefined) { process.stderr.write(usage); process.exit(2); }
    options[flag] = value;
  }
  const system = options['--system'] as System | undefined;
  if (dir === undefined || system === undefined || !(SYSTEMS as readonly string[]).includes(system)) { process.stderr.write(usage); process.exit(2); }
  const runStarted = options['--run-started'] === undefined ? undefined : parseRunStarted(options['--run-started']);
  const { text, failed } = await judge(resolve(dir), system, { profile: options['--profile'], summary: options['--summary'], runStarted });
  process.stdout.write(text);
  process.exit(failed ? 1 : 0);
}
