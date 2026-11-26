import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// design/decisions.md, "A test that fails only its time budget runs once more alone". Only this message, whole, is time alone: the harness joins a second problem to it with a line feed, and node:test keeps the first error of a test, so a failed assertion hides the budget the harness checks after the body.
const TIME_ONLY = /^harness-6: the test took (\d+) ms, past its budget of (\d+) ms \(tests\/numbers\.ts\)$/;

export const ALONE = 'lawcheck:alone';

const RECORDER = new URL('./record.ts', import.meta.url).href;

export interface Late {
  file: string;
  name: string;
  took: number;
  budget: number;
}

export interface Alone extends Late {
  passed: boolean;
  ms: number | null;
  error: string | null;
}

function rootCause(error: any): any {
  let e = error;
  while (e && e.code === 'ERR_TEST_FAILURE' && e.cause) e = e.cause;
  return e ?? error;
}

export function timeOnly(error: unknown): { took: number; budget: number } | null {
  const cause = rootCause(error);
  if (cause === null || typeof cause !== 'object' || cause.invariant !== 'harness-6' || typeof cause.message !== 'string') return null;
  const found = TIME_ONLY.exec(cause.message);
  return found === null ? null : { took: Number(found[1]), budget: Number(found[2]) };
}

export function messageOf(error: unknown): string {
  const e = rootCause(error);
  if (e === undefined || e === null) return 'no error was reported';
  if (typeof e === 'string') return e;
  return typeof e.message === 'string' && e.message !== '' ? e.message : String(e);
}

const exact = (name: string): string => `/^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$/`;

// The test alone: one process, one test file, no other test of it, and nothing else of the run still going.
export function runAlone(late: Late, base: string[], env: NodeJS.ProcessEnv, cwd: string): Alone {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-alone-'));
  try {
    const events = join(dir, 'events.jsonl');
    spawnSync(process.execPath, [...base, `--test-reporter=${RECORDER}`, `--test-reporter-destination=${events}`, '--test-concurrency=1', `--test-name-pattern=${exact(late.name)}`, late.file], { cwd, env, stdio: ['ignore', 'ignore', 'inherit'] });
    const lines = existsSync(events) ? readFileSync(events, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; data: any }) : [];
    const ended = lines.filter((e) => (e.type === 'test:pass' || e.type === 'test:fail') && e.data?.nesting === 0 && e.data?.name === late.name && e.data?.details?.type !== 'suite');
    if (ended.length !== 1) return { ...late, passed: false, ms: null, error: `the second run alone reported the test ${ended.length} times, not once` };
    const [one] = ended;
    const ms = Math.round(one!.data.details?.duration_ms ?? 0);
    if (one!.type === 'test:pass' && one!.data.skip === undefined && one!.data.todo === undefined) return { ...late, passed: true, ms, error: null };
    return { ...late, passed: false, ms, error: one!.type === 'test:pass' ? 'the second run alone skipped the test' : messageOf(one!.data.details?.error) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function aloneLine(alone: Alone, where: (file: string) => string): string {
  const first = `${alone.took} ms in the run, past its budget of ${alone.budget} ms`;
  if (alone.passed) return `slow under load  ${alone.name.slice(0, 90)}  ${where(alone.file)}: ${first}; ${alone.ms} ms alone, so it counts once, as passed`;
  return `RED      ${alone.name.slice(0, 90)}  ${where(alone.file)}: ${first}; the second run alone is red too: ${(alone.error ?? '').split('\n')[0]!.slice(0, 300)}`;
}

// What the reporter of the first run leaves for the runner: whether the run is red without its late tests, and those tests.
export interface FirstVerdict {
  red: boolean;
  late: Late[];
}

export function readFirst(path: string): FirstVerdict | null {
  try {
    const read = JSON.parse(readFileSync(path, 'utf8')) as FirstVerdict;
    return typeof read.red === 'boolean' && Array.isArray(read.late) ? read : null;
  } catch {
    return null;
  }
}

// One round of tests/run.ts: the run, then each test that failed only its time budget once more alone, one after another. The run is red when its reporter judged it red, when its process failed for any reason the reporter did not leave a verdict for, or when a second run is red. With a recording, each second run joins the events of the run as one event of its own, so a merge of the shards reads what the run decided and counts the test once.
export function runRound(first: (verdict: string) => string[], base: string[], env: NodeJS.ProcessEnv, events: string | null, write: (text: string) => void, where: (file: string) => string, cwd: string, stdout: 'inherit' | number = 'inherit'): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-round-'));
  try {
    const path = join(dir, 'verdict.json');
    const result = spawnSync(process.execPath, first(path), { cwd, env, stdio: ['inherit', stdout, 'inherit'] });
    if (result.status === 0) return false;
    const verdict = readFirst(path);
    if (verdict === null || verdict.late.length === 0) return true;
    let red = verdict.red;
    const lines: string[] = ['', 'once more alone, after the run'];
    for (const late of verdict.late) {
      const alone = runAlone(late, base, env, cwd);
      if (!alone.passed) red = true;
      lines.push(aloneLine(alone, where));
      if (events !== null) appendFileSync(events, `${JSON.stringify({ type: ALONE, data: alone })}\n`);
    }
    lines.push(red ? 'the run is red' : 'the run is green: every test past its budget passed alone');
    write(`${lines.join('\n')}\n`);
    return red;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The tests of recorded events that failed only their time budget and passed once more alone, by file and name.
export function clearedAlone(events: { type: string; data: any }[]): Set<string> {
  const passed = new Set(events.filter((e) => e.type === ALONE && e.data?.passed === true).map((e) => `${e.data.file}\0${e.data.name}`));
  const out = new Set<string>();
  for (const e of events) {
    if (e.type !== 'test:fail' || e.data?.nesting !== 0 || e.data?.details?.type === 'suite') continue;
    const key = `${e.data.file}\0${e.data.name}`;
    if (passed.has(key) && timeOnly(e.data.details?.error) !== null) out.add(key);
  }
  return out;
}
