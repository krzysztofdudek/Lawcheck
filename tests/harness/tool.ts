import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach } from 'node:test';
import { KILLED_GRACE_MS, LEFTOVER_GRACE_MS, RUN_BUDGET_MS, SLOW_TESTS, TEST_BUDGET_MS } from '../numbers.ts';
import { Broken, hasInternal, jsonProblem, outputProblem, stringsOf } from './invariants.ts';
import { killAll, Tracker } from './processes.ts';
import { gitChanges, gitState, gitTop, treeChanges, treeState } from './state.ts';
import type { GitState } from './state.ts';
import { testIds } from './promises.ts';
import { skipReason } from './skips.ts';

export { PLATFORM_SKIPS } from './skips.ts';
export type { PlatformSkip } from './skips.ts';

const ROOT_DIR = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
export const ROOT = ROOT_DIR + sep;
export const CLI = join(ROOT, 'dist', 'cli.js');
export const HOOK = join(ROOT, 'plugin', 'hooks', 'lawcheck-hook.mjs');

export class CouldNotRun extends Error {
  constructor(missing: string) {
    super(`could not run: ${missing}`);
    this.name = 'CouldNotRun';
  }
}

export interface Expect {
  stderr?: string | RegExp;
  internal?: boolean;
  // Paths relative to the top of the work tree.
  writes?: (string | RegExp)[];
  signal?: NodeJS.Signals;
  repo?: string;
  budget?: number;
}

export interface Run {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: any;
  readonly ms: number;
}

export interface Running {
  readonly pid: number;
  stdout(): string;
  stderr(): string;
  kill(signal?: NodeJS.Signals): void;
  readonly ended: Promise<Run>;
}

// A program is a test program of this repository (the stability measurement, the agent trial): it reports on standard error in its own words, and invariants 2 to 5 are promises of Lawcheck's own output.
type Kind = 'cli' | 'hook' | 'program';

interface Start {
  kind: Kind;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  ownTemp: boolean;
  stdin?: string;
  args: string[];
}

interface TestState {
  name: string;
  started: number;
  budget: number;
  runs: number;
  compared: number;
  pending: Set<Promise<unknown>>;
  failures: { error: Error; consumed: boolean }[];
  root: Map<string, string>;
}

let current: TestState | null = null;
const active = new Map<string, number>();

function budgetOf(name: string): number {
  for (const id of testIds(name)) if (SLOW_TESTS[id] !== undefined) return SLOW_TESTS[id]!;
  return TEST_BUDGET_MS;
}

const REGISTERED = Symbol.for('lawcheck.harness');
const registry = globalThis as { [REGISTERED]?: boolean };
if (!registry[REGISTERED]) {
  registry[REGISTERED] = true;
  beforeEach((t) => {
    current = { name: t.name, started: Date.now(), budget: budgetOf(t.name), runs: 0, compared: 0, pending: new Set(), failures: [], root: treeState(ROOT_DIR) };
  });
  afterEach(async () => {
    const state = current;
    current = null;
    if (state === null) return;
    await Promise.allSettled([...state.pending]);
    const problems: string[] = [];
    const open = state.failures.find((f) => !f.consumed);
    if (open !== undefined) throw open.error;
    if (state.runs > 0 && state.compared === 0) problems.push(`harness-count: the test started the tool ${state.runs} times and read none of its outputs`);
    const changed = treeChanges(state.root, treeState(ROOT_DIR));
    if (changed.length > 0) problems.push(`harness-8: the test changed the Lawcheck checkout: ${changed.slice(0, 10).join(', ')}`);
    const took = Date.now() - state.started;
    if (took > state.budget) problems.push(`harness-6: the test took ${took} ms, past its budget of ${state.budget} ms (tests/numbers.ts)`);
    if (problems.length > 0) throw new Broken(problems[0]!.slice(0, problems[0]!.indexOf(':')), problems.map((p) => p.slice(p.indexOf(':') + 2)).join('\n'));
  });
}

export function platformSkip(part: string): string | null {
  if (current === null) throw new Error('harness: platformSkip is called outside a test');
  return skipReason(current.name, part);
}

export async function expectBroken(invariant: string, body: () => Promise<unknown>): Promise<Broken> {
  try {
    await body();
  } catch (error) {
    if (error instanceof Broken && error.invariant === invariant) {
      if (current !== null) current.compared++;
      for (const failure of current?.failures ?? []) if (failure.error === error) failure.consumed = true;
      return error;
    }
    throw error;
  }
  throw new Error(`the run broke no invariant; ${invariant} was expected`);
}

function observed(raw: { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; json: unknown; ms: number }): Run {
  const run = {} as Run;
  const mark = () => {
    if (current !== null) current.compared++;
  };
  for (const key of ['code', 'signal', 'stdout', 'stderr', 'json'] as const) {
    Object.defineProperty(run, key, {
      enumerable: true,
      get() {
        mark();
        return raw[key];
      },
    });
  }
  Object.defineProperty(run, 'ms', { enumerable: true, value: raw.ms });
  return run;
}

function contractWrites(start: Start): RegExp[] {
  if (start.kind !== 'cli') return [];
  const command = start.args[0];
  if (command === 'init') return [/(^|\/)\.lawcheck\/(law\.yaml|\.gitignore)$/];
  if (command === 'check' && start.args.includes('--review')) return [/(^|\/)\.lawcheck\/(verdicts|\.gitattributes)$/, /(^|\/)\.lawcheck\/\.local\//];
  return [];
}

// spec/reviewer-slice.md, section 6: before its calls the tool writes one line to standard error with the number of calls and the provider; spec/questions.md, question 18, fixes its words.
const CALLS_LINE = /^(lawcheck: \d+ reviewer calls? to (openai-compatible|anthropic|claude-code)\n)?$/;

function contractStderr(start: Start): RegExp | null {
  if (start.kind !== 'cli') return null;
  if ((start.args[0] === 'check' && start.args.includes('--review')) || start.args[0] === 'try') return CALLS_LINE;
  return null;
}

function allowed(path: string, rules: (string | RegExp)[]): boolean {
  return rules.some((rule) => (typeof rule === 'string' ? rule === path || (rule.endsWith('/') && path.startsWith(rule)) : rule.test(path)));
}

function repoOf(start: Start, expect: Expect): string | null {
  if (expect.repo !== undefined) return gitTop(expect.repo);
  let folder = start.cwd;
  if (start.kind === 'hook' && start.stdin !== undefined) {
    try {
      const input = JSON.parse(start.stdin) as { cwd?: unknown };
      if (typeof input.cwd === 'string' && existsSync(input.cwd)) folder = input.cwd;
    } catch {
      folder = start.cwd;
    }
  }
  const top = gitTop(folder);
  if (top === null) return null;
  const real = realpathSync(top);
  return real === ROOT_DIR ? null : real;
}

function launch(start: Start, expect: Expect): Running {
  if (start.kind === 'cli' && !existsSync(start.argv[start.argv.length - start.args.length - 1]!)) throw new CouldNotRun(`${start.argv[start.argv.length - start.args.length - 1]} is missing; run npm run build`);
  const state = current;
  const top = repoOf(start, expect);
  if (top !== null) {
    if ((active.get(top) ?? 0) > 0) throw new Error(`harness: two runs at once in ${top}; give each run its own repository`);
    active.set(top, (active.get(top) ?? 0) + 1);
  }
  const before: GitState | null = top === null ? null : gitState(top);
  const temp = start.ownTemp ? null : realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-run-')));
  const env: NodeJS.ProcessEnv = temp === null ? start.env : { ...start.env, TMPDIR: temp, TMP: temp, TEMP: temp };
  const budget = expect.budget ?? state?.budget ?? RUN_BUDGET_MS;
  const began = Date.now();
  const child = spawn(process.execPath, start.argv, { cwd: start.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  if (child.pid === undefined) throw new Error(`harness: ${start.argv.join(' ')} did not start`);
  const pid = child.pid;
  const tracker = new Tracker(pid, [temp, top].filter((f): f is string => f !== null));
  let stdout = '';
  let stderr = '';
  let sent: NodeJS.Signals | null = null;
  let overran = false;
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  child.stdin.on('error', () => {});
  child.stdin.end(start.stdin ?? '');
  const timer = setTimeout(() => {
    overran = true;
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, budget);
  if (state !== null) state.runs++;
  const ended = new Promise<Run>((resolve, reject) => {
    child.on('error', (error) => {
      clearTimeout(timer);
      tracker.stop();
      reject(error);
    });
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      const ms = Date.now() - began;
      tracker.stop();
      const problems: [string, string][] = [];
      const grace = sent === 'SIGKILL' || overran ? KILLED_GRACE_MS : LEFTOVER_GRACE_MS;
      let left = tracker.alive();
      const until = Date.now() + grace;
      while (left.length > 0 && Date.now() < until) {
        await new Promise((done) => setTimeout(done, 20));
        left = tracker.alive();
      }
      if (left.length > 0) {
        problems.push(['harness-6', `alive ${grace} ms after the run ended: ${tracker.describe(left)}`]);
        killAll(left);
      }
      if (overran) problems.push(['harness-6', `the run did not end within its budget of ${budget} ms`]);
      if (signal !== null && signal !== sent && signal !== expect.signal && !overran) problems.push(['harness-1', `the run died by ${signal}`]);
      if (code !== null && ![0, 1, 2].includes(code)) problems.push(['harness-1', `exit code ${code}`]);
      let document: unknown;
      if (start.kind === 'cli' && start.args.includes('--json')) {
        const found = jsonProblem(stdout, code);
        document = found.document;
        if (found.problem !== null && !overran && signal === null) problems.push(['harness-3', found.problem]);
      }
      if (start.kind === 'hook' && stdout !== '') {
        try {
          document = JSON.parse(stdout);
          if (document === null || typeof document !== 'object' || Array.isArray(document)) problems.push(['harness-3', 'the hook printed JSON that is not an object']);
        } catch {
          problems.push(['harness-3', `the hook printed something other than one JSON document: ${JSON.stringify(stdout.slice(0, 120))}`]);
        }
      }
      if (start.kind !== 'program') {
        const texts: [string, string][] = [['standard error', stderr]];
        if (start.kind === 'cli' && document === undefined) texts.push(['standard output', stdout]);
        if (start.kind === 'hook' && document !== undefined) for (const text of stringsOf(document)) texts.push(['a string of the hook output', text]);
        for (const [where, text] of texts) {
          const problem = outputProblem(text);
          if (problem !== null) problems.push(['harness-2', `${where}: ${problem}`]);
        }
        const internal = start.kind === 'cli' ? hasInternal(stdout, document) : stringsOf(document).some((text) => hasInternal(text, undefined)) || hasInternal(stderr, undefined);
        if (internal && !expect.internal) problems.push(['harness-5', `the run ended with internal: ${JSON.stringify((document === undefined ? stdout : JSON.stringify(document)).slice(0, 300))}`]);
      }
      const byContract = contractStderr(start);
      if (start.kind === 'program') {
        if (expect.stderr !== undefined && (typeof expect.stderr === 'string' ? stderr !== expect.stderr : !expect.stderr.test(stderr))) problems.push(['harness-4', `standard error is ${JSON.stringify(stderr.slice(0, 300))}, expected ${expect.stderr}`]);
      } else if (expect.stderr === undefined) {
        if (stderr !== '' && !(byContract !== null && byContract.test(stderr))) problems.push(['harness-4', `standard error is not empty: ${JSON.stringify(stderr.slice(0, 300))}`]);
      } else if (typeof expect.stderr === 'string' ? stderr !== expect.stderr : !expect.stderr.test(stderr)) {
        problems.push(['harness-4', `standard error is ${JSON.stringify(stderr.slice(0, 300))}, expected ${expect.stderr}`]);
      }
      if (top !== null) {
        active.set(top, (active.get(top) ?? 1) - 1);
        const after = gitState(top);
        if (before !== null && after !== null) {
          const changes = gitChanges(before, after);
          const rules = [...contractWrites(start), ...(expect.writes ?? [])];
          const unexpected = changes.paths.filter((path) => !allowed(path, rules));
          const parts = [...(changes.head ? ['HEAD'] : []), ...(changes.index ? ['the index'] : []), ...(changes.config ? ['.git/config'] : []), ...unexpected];
          if (parts.length > 0) problems.push(['harness-7', `the run changed ${parts.slice(0, 10).join(', ')} in ${top}`]);
        }
      }
      if (temp !== null) {
        const leftFiles = readdirSync(temp);
        if (leftFiles.length > 0) problems.push(['harness-8', `the run left ${leftFiles.slice(0, 10).join(', ')} in its temporary folder`]);
        rmSync(temp, { recursive: true, force: true, maxRetries: 10 });
      }
      const raw = { code, signal, stdout, stderr, json: start.kind === 'hook' ? (document ?? null) : document, ms };
      if (problems.length > 0) {
        const detail = problems.map(([id, text]) => `${id}: ${text}`).join('\n') + `\nthe run: ${start.args.join(' ')} in ${start.cwd}\nexit ${code}${signal ? ` by ${signal}` : ''}\nstdout: ${JSON.stringify(stdout.slice(0, 2000))}\nstderr: ${JSON.stringify(stderr.slice(0, 2000))}`;
        const error = new Broken(problems[0]![0], detail.slice(detail.indexOf(':') + 2));
        state?.failures.push({ error, consumed: false });
        reject(error);
        return;
      }
      resolve(observed(raw));
    });
  });
  ended.catch(() => {});
  state?.pending.add(ended);
  return {
    pid,
    stdout: () => stdout,
    stderr: () => stderr,
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      sent = signal;
      child.kill(signal);
    },
    ended,
  };
}

export interface ToolOptions extends Expect {
  env?: NodeJS.ProcessEnv;
  node?: string[];
  cli?: string;
  stdin?: string;
}

function ownTemp(env: NodeJS.ProcessEnv | undefined): boolean {
  return env !== undefined && ['TMPDIR', 'TMP', 'TEMP'].some((name) => name in env);
}

export function startTool(cwd: string, args: string[], base: NodeJS.ProcessEnv, options: ToolOptions = {}): Running {
  const cli = options.cli ?? CLI;
  return launch({ kind: 'cli', argv: [...(options.node ?? []), cli, ...args], cwd, env: { ...base, ...options.env }, ownTemp: ownTemp(options.env), stdin: options.stdin, args }, options);
}

export function startHook(event: string, input: string, env: NodeJS.ProcessEnv, options: Expect & { hook?: string; cwd?: string } = {}): Running {
  return launch({ kind: 'hook', argv: [options.hook ?? HOOK, event], cwd: options.cwd ?? ROOT, env, ownTemp: ownTemp(env), stdin: input, args: [event] }, options);
}

export function startProgram(script: string, args: string[], cwd: string, base: NodeJS.ProcessEnv, options: Expect & { env?: NodeJS.ProcessEnv } = {}): Running {
  return launch({ kind: 'program', argv: [script, ...args], cwd, env: { ...base, ...options.env }, ownTemp: ownTemp(options.env), args: [script, ...args] }, options);
}
