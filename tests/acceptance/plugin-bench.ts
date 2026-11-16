import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { alive, D, D_PATH, inTemp, makeSample, ROOT, write } from './helpers.ts';
import type { Run, Running } from './helpers.ts';
import { fakeWrites, platformSkip, startHook, waitUntil } from '../harness/tool.ts';
import type { HookOptions } from '../harness/tool.ts';
import { installedLawcheck, packageRunner } from '../harness/fakes.ts';
import { HOOK_PAST_DEADLINE_MS, HOOK_SIGTERM_AFTER_MS, STOPPED_HOOK_ENDS_MS } from '../numbers.ts';
import { DEADLINES } from '../../plugin/hooks/start.mjs';

export const PLUGIN = join(ROOT, 'plugin');
export const HOOK = join(PLUGIN, 'hooks', 'lawcheck-hook.mjs');
export const NODE_DIR = dirname(process.execPath);
export const WINDOWS = process.platform === 'win32';
export const where = (program: string) =>
  WINDOWS ? execFileSync('where.exe', [program], { encoding: 'utf8' }).split(/\r?\n/)[0]!.trim() : execFileSync('sh', ['-c', `command -v ${program}`], { encoding: 'utf8' }).trim();
export const GIT_DIR = dirname(where('git'));
export const SYSTEM_ENV: NodeJS.ProcessEnv = WINDOWS ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec } : {};
export const edited = (text: string) => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });
export const EVENT_NAMES: Record<string, string> = { 'session-start': 'SessionStart', prompt: 'UserPromptSubmit', edit: 'PostToolUse', stop: 'Stop' };

export type HookRun = Run;

export interface LogLine {
  args: string[];
  cwd: string;
}

export class Bench {
  readonly bin: string;
  readonly data: string;
  readonly logFile: string;
  readonly runnerLog: string;
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
    // The plugin writes its state under CLAUDE_PLUGIN_DATA, and the stand-ins of lawcheck and of the runners log their calls beside it.
    fakeWrites(dir, ['data/', 'lawcheck.log', 'runner.log']);
    this.bin = join(dir, 'bin');
    this.data = join(dir, 'data');
    this.logFile = join(dir, 'lawcheck.log');
    this.runnerLog = join(dir, 'runner.log');
    mkdirSync(this.bin, { recursive: true });
    this.script('lawcheck', installedLawcheck(this.logFile));
  }

  script(name: string, body: string[]): void {
    const path = join(this.bin, name);
    writeFileSync(path, [`#!${process.execPath}`, "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';", "import { spawn, spawnSync } from 'node:child_process';", ...body, ''].join('\n'));
    chmodSync(path, 0o755);
    // A package manager installs a program on Windows as a .cmd file of this shape.
    if (WINDOWS) writeFileSync(`${path}.cmd`, `@"${process.execPath}" "${path}" %*\r\n`);
  }

  remove(name: string): void {
    rmSync(join(this.bin, name), { force: true });
    rmSync(join(this.bin, `${name}.cmd`), { force: true });
  }

  runner(name: string, skip: number, yarn = false): void {
    this.script(name, packageRunner(this.runnerLog, name, skip, join(this.bin, 'lawcheck'), yarn));
  }

  log(): LogLine[] {
    return existsSync(this.logFile) ? readFileSync(this.logFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  }

  runners(): { runner: string; args: string[] }[] {
    return existsSync(this.runnerLog) ? readFileSync(this.runnerLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  }

  clearLog(): void {
    rmSync(this.logFile, { force: true });
    rmSync(this.runnerLog, { force: true });
  }

  checks(): string[][] {
    return this.log().filter((line) => line.args[0] === 'check').map((line) => line.args);
  }

  env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { PATH: [this.bin, GIT_DIR, NODE_DIR].join(delimiter), ...SYSTEM_ENV, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PLUGIN_DATA: this.data, ...extra };
  }

  sessions(): string[] {
    const dir = join(this.data, 'sessions');
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  state(id = 's1'): any {
    return JSON.parse(readFileSync(join(this.data, 'sessions', `${id}.json`), 'utf8'));
  }
}

export function hook(bench: Bench, event: string, input: string, env: NodeJS.ProcessEnv = {}, onStart?: (running: Running) => void, expect: HookOptions = {}): Promise<HookRun> {
  const running = startHook(event, input, bench.env(env), expect.deadlines === undefined ? { ...expect, hook: HOOK } : expect);
  onStart?.(running);
  return running.ended;
}

export class Session {
  prompts = 0;
  readonly bench: Bench;
  readonly cwd: string;
  readonly id: string;
  readonly env: NodeJS.ProcessEnv;

  readonly options: HookOptions;

  constructor(bench: Bench, cwd: string, id = 's1', env: NodeJS.ProcessEnv = {}, options: HookOptions = {}) {
    this.bench = bench;
    this.cwd = cwd;
    this.id = id;
    this.env = env;
    this.options = options;
  }

  input(event: string, fields: Record<string, unknown> = {}): string {
    return JSON.stringify({ session_id: this.id, prompt_id: `p${Math.max(this.prompts, 1)}`, cwd: this.cwd, hook_event_name: EVENT_NAMES[event] ?? event, ...fields });
  }

  run(event: string, fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return hook(this.bench, event, this.input(event, fields), { ...this.env, ...env }, undefined, this.options);
  }

  start(source = 'startup', fields: Record<string, unknown> = {}): Promise<HookRun> {
    return this.run('session-start', { source, ...fields });
  }

  prompt(env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    this.prompts++;
    return this.run('prompt', { prompt: 'go' }, env);
  }

  edit(path: string, tool = 'Write', fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
    return this.run('edit', { tool_name: tool, tool_input: { [key]: join(this.cwd, path) }, tool_response: {}, ...fields }, env);
  }

  stop(fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return this.run('stop', { stop_hook_active: false, background_tasks: [], last_assistant_message: 'done', ...fields }, env);
  }
}

export async function withBench<T>(body: (bench: Bench, dir: string) => Promise<T>): Promise<T> {
  return inTemp((dir) => body(new Bench(dir), dir));
}

export function nothing(run: HookRun, what = ''): void {
  assert.equal(run.stdout, '', `${what}: ${run.stdout}${run.stderr}`);
  assert.equal(run.code, 0, `${what}: ${run.stderr}`);
}

export function json(run: HookRun, expected: unknown, what = ''): void {
  assert.equal(run.code, 0, `${what}: ${run.stderr}`);
  assert.deepEqual(run.json, expected, what);
}

export async function ended(...pids: number[]): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    if (!pids.some(alive)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

// Test 163 of spec/plugin-slice.md: a stand-in lawcheck that never answers, run by the edit hook and by the stop hook to their deadlines, then by an edit hook stopped by SIGTERM. With deadlines given, the first two hooks run with them in place of the shipped ones; the third is the shipped hook, stopped once the stand-in has started, or after a fixed time.
export async function deadlineScenario(deadlines: { edit: number; stop: number } | null, sigterm: 'started' | 'after 2 seconds'): Promise<void> {
  const edit = deadlines?.edit ?? DEADLINES.edit;
  const stop = deadlines?.stop ?? DEADLINES.stop;
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    const pids = join(dir, 'pids');
    fakeWrites(dir, ['pids']);
    bench.script('lawcheck', [
      "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300000)'], { stdio: 'ignore' });",
      `writeFileSync(${JSON.stringify(pids)}, process.pid + ' ' + c.pid);`,
      'setTimeout(() => {}, 300000);',
    ]);
    const gone = async () => {
      assert.ok(existsSync(pids), 'the stand-in lawcheck did not start before the deadline');
      const [a, b] = readFileSync(pids, 'utf8').trim().split(' ').map(Number);
      assert.ok(await ended(a!, b!), `${a} ${b}`);
      rmSync(pids);
    };
    const within = (run: HookRun, seconds: number) => {
      assert.ok(run.ms >= seconds * 1000, `the hook ended after ${run.ms} ms, before its deadline of ${seconds} seconds`);
      assert.ok(run.ms < seconds * 1000 + HOOK_PAST_DEADLINE_MS, `the hook ended after ${run.ms} ms, past its deadline of ${seconds} seconds and ${HOOK_PAST_DEADLINE_MS} ms`);
    };
    const session = new Session(bench, s, 's1', {}, deadlines === null ? {} : { deadlines: { edit, stop } });
    const late = await session.edit(D_PATH);
    within(late, edit);
    json(late, edited(`Lawcheck: lawcheck check ./${D_PATH} did not finish within ${edit} seconds and was stopped.`));
    await gone();
    rmSync(join(s, D_PATH));
    await session.prompt();
    write(s, D_PATH, D);
    const stopped = await session.stop();
    within(stopped, stop);
    json(stopped, { systemMessage: `lawcheck: the check before the agent finished did not run: it did not finish within ${stop} seconds.` });
    await gone();
    if (platformSkip('a hook stopped by SIGTERM') !== null) return;
    let sent = 0;
    const term = await hook(bench, 'edit', session.input('edit', { tool_name: 'Write', tool_input: { file_path: join(s, D_PATH) } }), {}, (running) => {
      const send = () => {
        sent = Date.now();
        running.kill('SIGTERM');
      };
      if (sigterm === 'after 2 seconds') setTimeout(send, HOOK_SIGTERM_AFTER_MS);
      else void waitUntil(() => existsSync(pids), 'FAKE_STARTED_MS').then((seen) => (seen ? send() : undefined));
    });
    assert.ok(sent > 0, 'the stand-in lawcheck did not start, so no SIGTERM was sent');
    assert.equal(term.code, 0);
    assert.equal(term.stdout, '');
    assert.ok(term.ms < (sigterm === 'after 2 seconds' ? HOOK_SIGTERM_AFTER_MS : 0) + STOPPED_HOOK_ENDS_MS, String(term.ms));
    await gone();
  });
}
