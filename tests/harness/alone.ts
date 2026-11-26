import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// design/decisions.md, "A test that fails only its time budget runs once more alone". In the first run of a round the harness lets such a test pass with this diagnostic, so node still judges everything else of its file: a failure after a test ended, an exit code, a killed process, a red inside a describe. Once a test of a file has failed, node folds those into "subtests failed" and reports nothing more.
export const FIRST_RUN_VARIABLE = 'LAWCHECK_FIRST_RUN';
export const LATE_MARK = 'lawcheck-late ';

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

export function lateMark(name: string, took: number, budget: number): string {
  return `${LATE_MARK}${JSON.stringify({ name, took, budget })}`;
}

export function readMark(message: unknown): { name: string; took: number; budget: number } | null {
  if (typeof message !== 'string' || !message.startsWith(LATE_MARK)) return null;
  try {
    const read = JSON.parse(message.slice(LATE_MARK.length)) as { name?: unknown; took?: unknown; budget?: unknown };
    return typeof read.name === 'string' && typeof read.took === 'number' && typeof read.budget === 'number' ? { name: read.name, took: read.took, budget: read.budget } : null;
  } catch {
    return null;
  }
}

export const lateMessage = (late: { took: number; budget: number }): string => `harness-6: the test took ${late.took} ms, past its budget of ${late.budget} ms (tests/numbers.ts)`;

function rootCause(error: any): any {
  let e = error;
  while (e && e.code === 'ERR_TEST_FAILURE' && e.cause) e = e.cause;
  return e ?? error;
}

export function messageOf(error: unknown): string {
  const e = rootCause(error);
  if (e === undefined || e === null) return 'no error was reported';
  if (typeof e === 'string') return e;
  return typeof e.message === 'string' && e.message !== '' ? e.message : String(e);
}

const exact = (name: string): string => `/^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$/`;

// The test alone: one process, one test file, no other test of it, and nothing else of the run still going. Outside a first run the harness fails a test past its budget, so a red here is red.
export function runAlone(late: Late, base: string[], env: NodeJS.ProcessEnv, cwd: string): Alone {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-alone-'));
  try {
    const events = join(dir, 'events.jsonl');
    const result = spawnSync(process.execPath, [...base, `--test-reporter=${RECORDER}`, `--test-reporter-destination=${events}`, '--test-concurrency=1', `--test-name-pattern=${exact(late.name)}`, late.file], { cwd, env: withoutFirstRun(env), stdio: ['ignore', 'ignore', 'inherit'] });
    const lines = existsSync(events) ? readFileSync(events, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; data: any }) : [];
    const ended = lines.filter((e) => (e.type === 'test:pass' || e.type === 'test:fail') && e.data?.nesting === 0 && e.data?.name === late.name && e.data?.details?.type !== 'suite');
    if (ended.length !== 1) return { ...late, passed: false, ms: null, error: `the second run alone reported the test ${ended.length} times, not once` };
    const [one] = ended;
    const ms = Math.round(one!.data.details?.duration_ms ?? 0);
    if (one!.type === 'test:fail') return { ...late, passed: false, ms, error: messageOf(one!.data.details?.error) };
    if (one!.data.skip !== undefined || one!.data.todo !== undefined) return { ...late, passed: false, ms, error: 'the second run alone skipped the test' };
    if (result.status !== 0) return { ...late, passed: false, ms, error: `the process of the second run alone ended with ${result.status ?? result.signal}` };
    return { ...late, passed: true, ms, error: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withoutFirstRun(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  delete out[FIRST_RUN_VARIABLE];
  return out;
}

export function aloneLine(alone: Alone, where: (file: string) => string): string {
  const first = `${alone.took} ms in the run, past its budget of ${alone.budget} ms`;
  if (alone.passed) return `slow under load  ${alone.name.slice(0, 90)}  ${where(alone.file)}: ${first}; ${alone.ms} ms alone, so it counts once, as passed`;
  return `RED      ${alone.name.slice(0, 90)}  ${where(alone.file)}: ${first}; alone: ${(alone.error ?? '').split('\n')[0]!.slice(0, 300)}`;
}

// What the reporter of the first run leaves for the runner: its verdict, and the tests that passed with the late mark.
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

// One round of tests/run.ts. Only a first run that node and its reporter end green runs its late tests once more alone, one after another, and the round is green only when each of them passes there. Any other end of the first run is red, and its late tests do not run again. With a recording, each late test's outcome joins the events of the run as one event of its own, so a merge of the shards reads what the round decided.
export function runRound(first: (verdict: string) => string[], base: string[], env: NodeJS.ProcessEnv, events: string | null, write: (text: string) => void, where: (file: string) => string, cwd: string, stdout: 'inherit' | number = 'inherit'): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-round-'));
  try {
    const path = join(dir, 'verdict.json');
    const result = spawnSync(process.execPath, first(path), { cwd, env: { ...env, [FIRST_RUN_VARIABLE]: '1' }, stdio: ['inherit', stdout, 'inherit'] });
    const verdict = readFirst(path);
    const green = result.status === 0 && verdict !== null && !verdict.red;
    const late = verdict?.late ?? [];
    if (late.length === 0) return !green;
    const lines: string[] = ['', green ? 'once more alone, after the run' : 'not run alone: the run is red for more than time'];
    let red = !green;
    for (const one of late) {
      const alone: Alone = green ? runAlone(one, base, env, cwd) : { ...one, passed: false, ms: null, error: 'the run is red for more than time, so the test did not run alone' };
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
