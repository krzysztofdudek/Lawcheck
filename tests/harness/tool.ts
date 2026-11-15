import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach } from 'node:test';
import { budgetNamed, SLOW_TESTS, TEST_BUDGET_MS } from '../numbers.ts';
import { Broken } from './invariants.ts';
import { skipReason } from './skips.ts';
import { observe, ROOT_DIR } from './start.ts';
import { tree, treeChanges } from './state.ts';

export { CLI, CouldNotRun, HOOK, ROOT, startHook, startProgram, startTool, unpackTarball } from './start.ts';
export type { Expect, Run, Running, ToolOptions } from './start.ts';
export { PLATFORM_SKIPS } from './skips.ts';
export type { PlatformSkip } from './skips.ts';

interface TestState {
  file: string;
  name: string;
  started: number;
  budget: number;
  runs: number;
  compared: number;
  pending: Set<Promise<unknown>>;
  failures: { error: Error; consumed: boolean }[];
  folders: string[];
  fakes: Map<string, string[]>;
  root: Map<string, string>;
}

let current: TestState | null = null;

const fileOf = (path: string | undefined) => (path === undefined ? '' : relative(ROOT_DIR, path.startsWith('file:') ? fileURLToPath(path) : path).split(sep).join('/'));

const REGISTERED = Symbol.for('lawcheck.harness');
const registry = globalThis as { [REGISTERED]?: boolean };
if (!registry[REGISTERED]) {
  registry[REGISTERED] = true;
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
      budget: SLOW_TESTS[`${file} > ${t.name}`] ?? TEST_BUDGET_MS,
      runs: 0,
      compared: 0,
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
    const changed = treeChanges(state.root, tree(ROOT_DIR));
    if (changed.length > 0) problems.push(`harness-8: the test changed the Lawcheck checkout: ${changed.slice(0, 10).join(', ')}`);
    const took = Date.now() - state.started;
    if (took > state.budget) problems.push(`harness-6: the test took ${took} ms, past its budget of ${state.budget} ms (tests/numbers.ts)`);
    if (problems.length > 0) throw new Broken(problems[0]!.slice(0, problems[0]!.indexOf(':')), problems.map((p) => p.slice(p.indexOf(':') + 2)).join('\n'));
  });
}

// The test's own temporary folder: the harness puts each run's home and temporary directory in it and checks it whole after the run.
export function testFolder(prefix = 'lawcheck-test-'): { dir: string; remove(): void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
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
  const real = realpathSync(folder);
  const home = current.folders.find((f) => real === f || real.startsWith(f + sep));
  if (home === undefined) throw new Error(`harness: ${folder} is not inside a folder of this test (testFolder)`);
  const prefix = relative(home, real).split(sep).join('/');
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
  return skipReason(file, name, part);
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
