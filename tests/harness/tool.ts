import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire, register, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assertModule from 'node:assert';
import { afterEach, beforeEach } from 'node:test';
import { budgetNamed, slowBudget, TEST_BUDGET_MS } from '../numbers.ts';
import { Broken } from './invariants.ts';
import { skipReason } from './skips.ts';
import { CLI, gate, HOOK, HOOK_WITH_DEADLINES, observe, ROOT_DIR, TOOL_WITH_LIMITS } from './start.ts';
import { real, tree, treeChanges } from './state.ts';

export { CLI, CouldNotRun, DEADLINES_VARIABLE, HOOK, HOOK_WITH_DEADLINES, LIMITS_VARIABLE, ROOT, startHook, startProgram, startShell, startTool, TOOL_WITH_LIMITS, unpackTarball, withoutTypeStrippingWarning } from './start.ts';
export type { Expect, HookOptions, Run, Running, Shell, ToolOptions } from './start.ts';
export { PLATFORM_SKIPS } from './skips.ts';
export type { PlatformSkip } from './skips.ts';

interface TestState {
  file: string;
  name: string;
  started: number;
  budget: number;
  runs: number;
  compared: number;
  asserted: { n: number };
  skipped: boolean;
  pending: Set<Promise<unknown>>;
  failures: { error: Error; consumed: boolean }[];
  folders: string[];
  fakes: Map<string, string[]>;
  root: Map<string, string>;
}

let current: TestState | null = null;

const fileOf = (path: string | undefined) => (path === undefined ? '' : relative(ROOT_DIR, path.startsWith('file:') ? fileURLToPath(path) : path).split(sep).join('/'));

const slash = (text: string) => text.split('\\').join('/');
const TOOL_PATHS = [slash(CLI), slash(join(dirname(CLI), 'bin.cjs')), slash(HOOK), slash(HOOK_WITH_DEADLINES), slash(TOOL_WITH_LIMITS)];

// Whether a start names Lawcheck: the built tool by either of its entries, a hook, a copy's or the unpacked tarball's dist/cli.js or dist/bin.cjs, or a program called lawcheck.
export function namesTool(words: unknown[]): string | null {
  for (const word of words) {
    if (typeof word !== 'string') continue;
    const text = slash(word);
    if (TOOL_PATHS.includes(text) || /(^|[\s"'/])dist\/(cli\.js|bin\.cjs)(["'\s]|$)/.test(text) || /(lawcheck-hook|hook-with-deadlines|tool-with-limits)\.mjs(["'\s]|$)/.test(text) || /^(.*\/)?lawcheck(\.cmd|\.exe)?$/.test(text)) return word;
  }
  return null;
}

const SHELLS = /^(sh|bash|dash|zsh|ksh|cmd|powershell|pwsh)(\.exe)?$/i;

// A command line a shell reads: Lawcheck is named where lawcheck stands as a word of it, alone or ending a path, or where it names the built tool or a hook.
export function namesToolInLine(line: string): boolean {
  return /(^|[\s;&|("'`\/\\])lawcheck(\.cmd|\.exe|\.ps1)?($|[\s;&|)"'`])/.test(line) || /dist[\/\\](cli\.js|bin\.cjs)|lawcheck-hook\.mjs|hook-with-deadlines\.mjs|tool-with-limits\.mjs/.test(line);
}

// The strings of a start that a shell reads: the line of exec and execSync, and the words given to a shell program or under shell: true.
function shellLines(name: string, args: unknown[]): string[] {
  if (name === 'exec' || name === 'execSync') return typeof args[0] === 'string' ? [args[0]] : [];
  const program = typeof args[0] === 'string' ? args[0].split(/[\\/]/).pop()! : '';
  const words = Array.isArray(args[1]) ? args[1].filter((word): word is string => typeof word === 'string') : [];
  const options = (Array.isArray(args[1]) ? args[2] : args[1]) as { shell?: unknown } | undefined;
  if (SHELLS.test(program) || (options !== null && typeof options === 'object' && options.shell !== undefined && options.shell !== false)) return [typeof args[0] === 'string' ? args[0] : '', ...words];
  return [];
}

// The tests that start Lawcheck by hand because the harness cannot give the run what they test: a standard output that is a file descriptor of the test, one a shell closes, or a pipe the test closes early. The list may only shrink.
export const HAND_STARTS: { file: string; test: string }[] = [
  { file: 'tests/limits/writes.test.ts', test: 'test 240: S1-6, S5-13, S8-8, every command writing to /dev/full ends with exit 2 and says the result is lost' },
  { file: 'tests/limits/writes.test.ts', test: 'test 240: S1-6, S5-13, S8-8, every command writing to an output opened only for reading ends with exit 2' },
  { file: 'tests/limits/writes.test.ts', test: 'test 240: S1-6, a closed standard output is the same as one sent to /dev/null' },
  { file: 'tests/limits/writes.test.ts', test: 'test 240: S8-8, a reader that stops early ends the run with its own code and nothing on standard error' },
];

function handStartAllowed(): boolean {
  return current !== null && HAND_STARTS.some((entry) => entry.file === current!.file && entry.test === current!.name);
}

function guardStarts(): void {
  const require = createRequire(import.meta.url);
  const cp = require('node:child_process') as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    const original = cp[name]!;
    cp[name] = function guarded(this: unknown, ...args: unknown[]) {
      if (gate.open === 0) {
        const named = namesTool([args[0], ...(Array.isArray(args[1]) ? args[1] : [])]) ?? shellLines(name, args).find(namesToolInLine) ?? null;
        if (named !== null) throw new Error(`harness: a test started Lawcheck by hand (${named}); start it with startTool, startHook or unpackTarball of tests/harness/tool.ts, which check every run`);
      }
      return original.apply(this, args);
    };
  }
  syncBuiltinESMExports();
}

// Every function of node:assert counts the assertion it makes for the test that is running. A hook that asserts, and an assertion in a timer callback, which may run after its test, are refused by the rail.
function countAssertions(): void {
  const plain = assertModule as unknown as Record<string, unknown>;
  const plainMatch = plain.match;
  const targets = [assertModule, assertModule.strict] as unknown as Record<string, unknown>[];
  for (const target of targets) {
    for (const key of Object.keys(target)) {
      const original = target[key];
      if (typeof original !== 'function' || ['AssertionError', 'CallTracker', 'Assert', 'strict'].includes(key)) continue;
      target[key] = function counted(this: unknown, ...args: unknown[]) {
        if (current !== null) current.asserted.n++;
        if (key !== 'match') return (original as (...a: unknown[]) => unknown).apply(this, args);
        // Node 24.0 tells match from doesNotMatch by comparing its own function with assert.match, so a wrapped assert.match turns every match into doesNotMatch while it runs.
        const shown = plain.match;
        plain.match = plainMatch;
        try {
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        } finally {
          plain.match = shown;
        }
      };
    }
  }
  syncBuiltinESMExports();
}

const REGISTERED = Symbol.for('lawcheck.harness');
const registry = globalThis as { [REGISTERED]?: boolean };
if (!registry[REGISTERED]) {
  registry[REGISTERED] = true;
  guardStarts();
  countAssertions();
  if (process.env.LAWCHECK_SHUFFLE) register(new URL('./shuffle-hooks.mjs', import.meta.url), { data: { target: new URL('./shuffled-test.mjs', import.meta.url).href } });
  observe({
    budget: () => current?.budget ?? TEST_BUDGET_MS,
    folders: () => current?.folders ?? [],
    fakes: (folder) => current?.fakes.get(folder) ?? [],
    started: () => {
      if (current !== null) current.runs++;
    },
    compared: () => {
      if (current !== null) current.compared++;
    },
    failed: (error) => current?.failures.push({ error, consumed: false }),
    pending: (ended) => current?.pending.add(ended),
  });
  beforeEach((t) => {
    const file = fileOf((t as { filePath?: string }).filePath);
    current = {
      file,
      name: t.name,
      started: Date.now(),
      budget: slowBudget(`${file} > ${t.name}`) ?? TEST_BUDGET_MS,
      runs: 0,
      compared: 0,
      asserted: { n: 0 },
      skipped: false,
      pending: new Set(),
      failures: [],
      folders: [],
      fakes: new Map(),
      root: tree(ROOT_DIR),
    };
  });
  afterEach(async () => {
    const state = current;
    current = null;
    if (state === null) return;
    await Promise.allSettled([...state.pending]);
    const open = state.failures.find((f) => !f.consumed);
    if (open !== undefined) throw open.error;
    const problems: string[] = [];
    if (state.runs > 0 && state.compared === 0) problems.push(`harness-count: the test started the tool ${state.runs} times and read none of its outputs`);
    else if (state.asserted.n === 0 && !state.skipped) problems.push('harness-count: the test made no assertion');
    const changed = treeChanges(state.root, tree(ROOT_DIR));
    if (changed.length > 0) problems.push(`harness-8: the test changed the Lawcheck checkout: ${changed.slice(0, 10).join(', ')}`);
    const took = Date.now() - state.started;
    if (took > state.budget) problems.push(`harness-6: the test took ${took} ms, past its budget of ${state.budget} ms (tests/numbers.ts)`);
    if (problems.length > 0) throw new Broken(problems[0]!.slice(0, problems[0]!.indexOf(':')), problems.map((p) => p.slice(p.indexOf(':') + 2)).join('\n'));
  });
}

// The test's own temporary folder: the harness puts each run's home and temporary directory in it and checks it whole after the run.
export function testFolder(prefix = 'lawcheck-test-', within: string = tmpdir()): { dir: string; remove(): void } {
  const dir = real(mkdtempSync(join(within, prefix)));
  current?.folders.push(dir);
  return {
    dir,
    remove: () => {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
      if (current !== null) current.folders = current.folders.filter((f) => f !== dir);
    },
  };
}

// Files of a test's folder, outside the repository, that the test's own fakes write while a run lasts: a fake reviewer's record, a stand-in's log.
export function fakeWrites(folder: string, paths: string[]): void {
  if (current === null) throw new Error('harness: fakeWrites is called outside a test');
  const path = real(folder);
  const home = current.folders.find((f) => path === f || path.startsWith(f + sep));
  if (home === undefined) throw new Error(`harness: ${folder} is not inside a folder of this test (testFolder)`);
  const prefix = relative(home, path).split(sep).join('/');
  current.fakes.set(home, [...(current.fakes.get(home) ?? []), ...paths.map((path) => (prefix === '' ? path : `${prefix}/${path}`))]);
}

// Waits until the condition holds or the named time of tests/numbers.ts has passed, looking every 20 ms: for a change no event announces, such as a process ending.
export async function waitUntil(condition: () => boolean, budget: string): Promise<boolean> {
  const until = Date.now() + budgetNamed(budget);
  while (!condition()) {
    if (Date.now() >= until) return false;
    await new Promise((done) => setTimeout(done, 20));
  }
  return true;
}

export function currentTest(): { file: string; name: string } {
  if (current === null) throw new Error('harness: called outside a test');
  return { file: current.file, name: current.name };
}

export function platformSkip(part: string): string | null {
  const { file, name } = currentTest();
  const reason = skipReason(file, name, part);
  if (reason !== null && current !== null) current.skipped = true;
  return reason;
}

export async function expectBroken(invariant: string, body: () => Promise<unknown>): Promise<Broken> {
  try {
    await body();
  } catch (error) {
    if (error instanceof Broken && error.invariant === invariant) {
      if (current !== null) {
        current.compared++;
        current.asserted.n++;
      }
      for (const failure of current?.failures ?? []) if (failure.error === error) failure.consumed = true;
      return error;
    }
    throw error;
  }
  throw new Error(`the run broke no invariant; ${invariant} was expected`);
}

export interface ByHand {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

// A start for a test of HAND_STARTS alone: the package's bin, with a standard output the test gives, under a shell that redirects it, or a pipe the test closes after the first chunk.
export function startByHand(cwd: string, args: string[], env: NodeJS.ProcessEnv, how: { stdout?: 'pipe' | number; redirect?: string; closeAfterFirst?: boolean } = {}): Promise<ByHand> {
  if (!handStartAllowed()) throw new Error(`harness: ${current?.file ?? 'a test'} > "${current?.name ?? ''}" is not in HAND_STARTS of tests/harness/tool.ts`);
  const bin = join(dirname(CLI), 'bin.cjs');
  const [program, words] = how.redirect === undefined ? [process.execPath, [bin, ...args]] : ['/bin/sh', ['-c', `exec "$0" "$@" ${how.redirect}`, process.execPath, bin, ...args]];
  if (current !== null) {
    current.runs++;
    current.compared++;
  }
  return new Promise((resolve, reject) => {
    gate.open++;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(program, words, { cwd, env, stdio: ['ignore', how.stdout ?? 'pipe', 'pipe'] });
    } finally {
      gate.open--;
    }
    let out = '';
    let err = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      out += chunk;
      if (how.closeAfterFirst) child.stdout!.destroy();
    });
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout: out, stderr: err }));
  });
}
