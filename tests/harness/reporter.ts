import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOWEST_SHOWN, slowBudget, TEST_BUDGET_MS } from '../numbers.ts';
import { INVARIANTS } from './invariants.ts';
import { promiseOf, testIds } from './promises.ts';
import { loadInputs } from '../contract/spec-map.ts';
import { tieProblems } from '../contract/tie.ts';
import { COMMIT_GROUPS, NIGHTLY_GROUPS, setFiles } from './sets.ts';
import { applies, HARNESS, PLATFORM_SKIPS } from './skips.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLOSING = 'if the promise changed, the change says so in tests/weakenings.md, and the suite guard checks the row (tests/README.md)';

interface Failed {
  name: string;
  file: string;
  error: any;
}

const where = (file: string | undefined) => (file ? relative(ROOT, file.startsWith('file:') ? fileURLToPath(file) : file).split('\\').join('/') : '?');

function rootCause(error: any): any {
  let e = error;
  while (e && e.code === 'ERR_TEST_FAILURE' && e.cause) e = e.cause;
  return e ?? error;
}

function messageOf(error: any): string {
  const e = rootCause(error);
  if (e === undefined || e === null) return 'no error was reported';
  if (typeof e === 'string') return e;
  const text = typeof e.message === 'string' && e.message !== '' ? e.message : String(e);
  return text;
}

// node:test fails a test file whose process ended before it reported as a whole, with only "test failed"; its error keeps the signal or the exit code of that process.
function processEnd(error: any, oomKills: number | null): string {
  if (error?.code !== 'ERR_TEST_FAILURE') return '';
  if (typeof error.signal === 'string') {
    const oom = error.signal === 'SIGKILL' && oomKills !== null && oomKills > 0 ? `, and memory.events of this cgroup counts ${oomKills} ${oomKills === 1 ? 'process' : 'processes'} the kernel killed for lack of memory` : '';
    return `: ${error.signal} ended the process of the test file${oom}`;
  }
  if (error.failureType === 'testCodeFailure' && typeof error.exitCode === 'number' && error.exitCode !== 0) return `: the process of the test file exited with ${error.exitCode}`;
  return '';
}

// The kernel counts in memory.events every process of a cgroup it killed for lack of memory, as in a container at its memory limit.
function oomKills(): number | null {
  try {
    const own = /^0::(\/.*)$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'))?.[1];
    if (own === undefined) return null;
    const found = /^oom_kill (\d+)$/m.exec(readFileSync(join('/sys/fs/cgroup', own, 'memory.events'), 'utf8'));
    return found === null ? null : Number(found[1]);
  } catch {
    return null;
  }
}

function clip(text: string, lines: number): string[] {
  const all = text.split('\n');
  const kept = all.slice(0, lines).map((line) => (line.length > 300 ? line.slice(0, 300) + '...' : line));
  if (all.length > lines) kept.push(`... ${all.length - lines} more lines`);
  return kept;
}

const quote = (s: string) => JSON.stringify(s);
const shell = (s: string) => (/^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function block(failed: Failed, seeds: Map<string, string>, oomKills: number | null): string[] {
  const ids = testIds(failed.name);
  const file = where(failed.file);
  const message = messageOf(failed.error) + processEnd(failed.error, oomKills);
  const head = ids.length > 0 ? ids.join(', ') : failed.name.slice(0, 80);
  const out: string[] = [];
  const rerun = `rerun    npm run t -- ${ids.length > 0 ? shell(ids[0]!) : file}`;
  const missing = /^could not run: (.*)/s.exec(message);
  if (missing !== null) {
    out.push(`RED      ${head}  ${file}`, `could not run  ${clip(missing[1]!, 3).join(' ')}`, rerun);
    return out;
  }
  out.push(`RED      ${head}  ${file}`);
  if (ids.length === 0) out.push(`promise  none: the name "${failed.name.slice(0, 120)}" carries no test number, promise or finding id`);
  for (const id of ids) {
    const promised = promiseOf(id);
    out.push(promised !== null ? `promise  ${promised.where}: ${quote(promised.text)}` : id.startsWith('I-') ? `promise  ${id} is not in design/promises.md` : `promise  ${id}: what this test expects`);
  }
  const broke = /^(harness-[a-z0-9]+): /.exec(message);
  if (broke !== null && INVARIANTS[broke[1]!]) out.push(`broke    ${broke[1]}: ${INVARIANTS[broke[1]!]}`);
  const got = clip(message, 14);
  out.push(`got      ${got[0]}`, ...got.slice(1).map((line) => `         ${line}`));
  const counter = /Counterexample: (.*)/.exec(message);
  const seed = /seed: (-?\d+)/.exec(message)?.[1] ?? seeds.get(failed.file);
  if (seed !== undefined) out.push(`input    seed ${seed}${counter ? `, shrunk to ${counter[1]}` : ''}`);
  out.push(rerun, CLOSING);
  return out;
}

export type System = 'linux' | 'darwin' | 'win32';

export interface RunOptions {
  system: System;
  started: number | null;
  target: number;
  // Only a live run reads its own cgroup, once its events have ended; a merge of recorded shards runs elsewhere.
  oomKills?: () => number | null;
}

export interface Verdict {
  text: string;
  red: boolean;
}

// The verdict on a whole run: what a plain run exits with, and what the merge of a system's shards is held to.
export async function judgeRun(source: AsyncIterable<{ type: string; data: any }>, options: RunOptions): Promise<Verdict> {
  const failed: Failed[] = [];
  const times: { ms: number; name: string; file: string }[] = [];
  const files = new Set<string>();
  const seeds = new Map<string, string>();
  const skips: string[] = [];
  const unlistedSkips: string[] = [];
  const here = (platform: Parameters<typeof applies>[0]): boolean => (platform === 'root' ? applies(platform) : platform === options.system);
  const passed: { file: string; name: string }[] = [];
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0 };
  for await (const event of source) {
    const data = event.data ?? {};
    if (event.type === 'test:stdout' || event.type === 'test:stderr') {
      const message = String(data.message ?? '');
      const seen = /^seed (-?\d+)$/m.exec(message);
      if (seen !== null && data.file) seeds.set(data.file, seen[1]!);
      for (const m of message.matchAll(/^skip (.*)$/gm)) skips.push(`${m[1]}  ${where(data.file)}`);
      continue;
    }
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    if (data.details?.type === 'suite') {
      if (event.type === 'test:fail' && data.details?.error?.failureType !== 'subtestsFailed') {
        failed.push({ name: data.name, file: data.file, error: data.details.error });
        counts.failed++;
      }
      continue;
    }
    if (event.type === 'test:pass' && data.skip === undefined && data.todo === undefined && data.file) passed.push({ file: where(data.file), name: data.name });
    if ((data.skip !== undefined || data.todo !== undefined) && data.file && !PLATFORM_SKIPS.some((e) => e.file === where(data.file) && e.test === data.name && e.part === 'the whole test' && here(e.platform))) unlistedSkips.push(`${where(data.file)} > ${data.name}`);
    if (data.nesting !== 0) continue;
    if (data.file) files.add(data.file);
    const fileItself = data.file !== undefined && (data.name === data.file || data.name === where(data.file));
    if (fileItself && event.type === 'test:pass') continue;
    if (data.skip !== undefined) counts.skipped++;
    else if (data.todo !== undefined) counts.todo++;
    else if (event.type === 'test:pass') counts.passed++;
    else {
      counts.failed++;
      failed.push({ name: data.name, file: data.file, error: data.details?.error });
    }
    times.push({ ms: data.details?.duration_ms ?? 0, name: data.name, file: data.file });
  }
  const total = counts.passed + counts.failed + counts.skipped + counts.todo;
  const parts = [`${counts.passed} passed`, `${counts.failed} failed`];
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  if (counts.todo > 0) parts.push(`${counts.todo} todo`);
  const lines: string[] = [];
  const started = options.started;
  const took = started !== null && Number.isFinite(started) && started > 0 ? Date.now() - started : null;
  lines.push(`ran ${files.size} test files, ${total} tests: ${parts.join(', ')}${took === null ? '' : `, in ${(took / 1000).toFixed(1)} s`}`);
  const target = options.target;
  if (took !== null && target > 0 && took > target) lines.push(`past the target of ${target / 1000} s for this speed (tests/numbers.ts)`);
  for (const [file, seed] of seeds) lines.push(`seed ${seed}  ${where(file)}`);
  for (const skip of skips) lines.push(`skipped ${skip}`);
  times.sort((a, b) => b.ms - a.ms);
  if (times.length > 0) {
    lines.push('', 'slowest');
    for (const t of times.slice(0, SLOWEST_SHOWN)) lines.push(`${String(Math.round(t.ms)).padStart(8)} ms  ${t.name.slice(0, 90)}  ${where(t.file)}`);
    const unlisted = times.filter((t) => t.ms > TEST_BUDGET_MS / 5 && slowBudget(`${where(t.file)} > ${t.name}`, options.system) === null);
    if (unlisted.length > 0) {
      lines.push('', `past a fifth of TEST_BUDGET_MS with no entry in SLOW_TESTS for ${options.system}`);
      for (const t of unlisted) lines.push(`${String(Math.round(t.ms)).padStart(8)} ms  ${where(t.file)} > ${t.name}`);
    }
  }
  const kills = failed.length > 0 ? (options.oomKills?.() ?? null) : null;
  for (const f of failed) lines.push('', ...block(f, seeds, kills));
  let red = false;
  if (unlistedSkips.length > 0) {
    red = true;
    lines.push('', 'RED      a test was skipped or marked todo with no whole-test entry in PLATFORM_SKIPS for this system', 'promise  design/decisions.md, decision 79: a skip is a platform reason in the list of tests/harness/skips.ts', ...unlistedSkips.map((u) => `got      ${u}`));
  }
  if (process.env.LAWCHECK_TIE === '1') {
    const speed = process.env.LAWCHECK_SPEED === 'nightly' ? 'nightly' : 'commit';
    const dirs = [...new Set(Object.values(speed === 'nightly' ? NIGHTLY_GROUPS : COMMIT_GROUPS).flat())];
    const excused = PLATFORM_SKIPS.filter((e) => e.part === 'the whole test' && e.file !== HARNESS && here(e.platform)).map((e) => ({ file: e.file, name: e.test }));
    const ran = passed.filter((p) => !excused.some((e) => e.file === p.file && e.name === p.name));
    const problems = tieProblems(loadInputs(new URL('../../', import.meta.url), 0), setFiles(speed, dirs), ran, excused);
    if (problems.length > 0) {
      red = true;
      lines.push('', 'RED      the run-time tie of question 79', 'promise  design/decisions.md, decision 79: a test number, a promise or a finding is covered only by a test that ran and passed in this run', ...problems.slice(0, 20).map((p) => `got      ${p}`), CLOSING);
    }
  }
  return { text: lines.join('\n') + '\n', red: counts.failed > 0 || red };
}

export default async function* reporter(source: AsyncIterable<{ type: string; data: any }>): AsyncGenerator<string> {
  const started = Number(process.env.LAWCHECK_STARTED);
  const verdict = await judgeRun(source, { system: process.platform as System, started: Number.isFinite(started) && started > 0 ? started : null, target: Number(process.env.LAWCHECK_TARGET_MS), oomKills });
  if (verdict.red) process.exitCode = 1;
  yield verdict.text;
}
