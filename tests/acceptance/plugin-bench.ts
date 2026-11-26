import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { alive, atOnce, D, D_PATH, git, inTemp, makeSample, ROOT, write } from './helpers.ts';
import type { Run, Running } from './helpers.ts';
import { fakeWrites, platformSkip, startHook, waitUntil } from '../harness/tool.ts';
import type { HookOptions } from '../harness/tool.ts';
import { fakeGit, installedLawcheck, packageRunner, removeFakeGit } from '../harness/fakes.ts';
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

  shell(name: string, body: string[]): void {
    const path = join(this.bin, name);
    writeFileSync(path, ['#!/bin/sh', ...body, ''].join('\n'));
    chmodSync(path, 0o755);
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

// The inputs Codex 0.171.0 gave the hooks of a plugin in one real session, one per line: the session start, the prompt, an edit by apply_patch, the stop, a second edit and the stop after the hand-back.
export const CODEX_INPUTS: Record<string, unknown>[] = readFileSync(join(ROOT, 'tests', 'agent', 'samples', 'codex-hooks.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

export function patchOf(lines: string[]): string {
  return ['*** Begin Patch', ...lines, '*** End Patch', ''].join('\n');
}

export class CodexSession {
  turns = 0;
  readonly bench: Bench;
  readonly cwd: string;
  readonly id: string;
  readonly env: NodeJS.ProcessEnv;

  constructor(bench: Bench, cwd: string, id = 'c1', env: NodeJS.ProcessEnv = {}) {
    this.bench = bench;
    this.cwd = cwd;
    this.id = id;
    this.env = env;
  }

  input(event: string, fields: Record<string, unknown> = {}): string {
    const recorded = CODEX_INPUTS.find((input) => input.hook_event_name === EVENT_NAMES[event]);
    if (recorded === undefined) throw new Error(`no recorded Codex input for ${event}`);
    const turn = event === 'session-start' ? {} : { turn_id: `t${Math.max(this.turns, 1)}` };
    return JSON.stringify({ ...recorded, session_id: this.id, cwd: this.cwd, ...turn, ...fields });
  }

  run(event: string, fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return hook(this.bench, event, this.input(event, fields), { ...this.env, ...env }, undefined, { host: 'codex' });
  }

  start(source = 'startup'): Promise<HookRun> {
    return this.run('session-start', { source });
  }

  prompt(env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    this.turns++;
    return this.run('prompt', { prompt: 'go' }, env);
  }

  patch(lines: string[], env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return this.run('edit', { tool_name: 'apply_patch', tool_input: { command: patchOf(lines) } }, env);
  }

  stop(fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return this.run('stop', { stop_hook_active: false, last_assistant_message: 'done', ...fields }, env);
  }
}

// The inputs Copilot CLI 1.0.105 gave the hooks of the plugin's own manifest in real sessions, one per line: the session start, the prompt, a create, the stop, the prompt the hand-back opens, a second create, the stop after the hand-back, then a view and an edit of a later session.
export const COPILOT_INPUTS: Record<string, unknown>[] = readFileSync(join(ROOT, 'tests', 'agent', 'samples', 'copilot-hooks.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

const COPILOT_SHAPE: Record<string, string> = { 'session-start': 'source', prompt: 'prompt', edit: 'toolName', stop: 'stopReason' };

export class CopilotSession {
  readonly bench: Bench;
  readonly cwd: string;
  readonly id: string;
  readonly env: NodeJS.ProcessEnv;

  constructor(bench: Bench, cwd: string, id = 'k1', env: NodeJS.ProcessEnv = {}) {
    this.bench = bench;
    this.cwd = cwd;
    this.id = id;
    this.env = env;
  }

  input(event: string, fields: Record<string, unknown> = {}): string {
    const recorded = COPILOT_INPUTS.find((input) => Object.hasOwn(input, COPILOT_SHAPE[event]!));
    if (recorded === undefined) throw new Error(`no recorded Copilot input for ${event}`);
    return JSON.stringify({ ...recorded, sessionId: this.id, cwd: this.cwd, ...fields });
  }

  run(event: string, fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return hook(this.bench, event, this.input(event, fields), { ...this.env, ...env }, undefined, { host: 'copilot' });
  }

  start(source = 'new'): Promise<HookRun> {
    return this.run('session-start', { source });
  }

  prompt(env: NodeJS.ProcessEnv = {}, text = 'go'): Promise<HookRun> {
    return this.run('prompt', { prompt: text }, env);
  }

  write(tool: string, path: string, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    const args = tool === 'create' ? { path: join(this.cwd, path), file_text: '' } : { path: join(this.cwd, path), old_str: 'a', new_str: 'b' };
    return this.run('edit', { toolName: tool, toolArgs: args, toolResult: { resultType: 'success', textResultForLlm: 'done' } }, env);
  }

  stop(fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return this.run('stop', { stop_hook_active: false, ...fields }, env);
  }
}

const CURSOR_EVENTS: Record<string, string> = { 'session-start': 'sessionStart', prompt: 'beforeSubmitPrompt', edit: 'postToolUse', stop: 'stop' };

// The inputs of the hooks that Cursor runs for the Claude Code plugin, with the fields that Cursor's documentation of its hooks and the hooks of Cursor Agent CLI 2026.11.22 give them. No session of Cursor recorded them. Cursor runs a plugin's hooks from the plugin's folder, so the hook starts there; only the stop runs from the workspace, and only the edit input holds a cwd.
export class CursorSession {
  turns = 0;
  readonly bench: Bench;
  readonly cwd: string;
  readonly id: string;
  readonly env: NodeJS.ProcessEnv;

  constructor(bench: Bench, cwd: string, id = 'u1', env: NodeJS.ProcessEnv = {}) {
    this.bench = bench;
    this.cwd = cwd;
    this.id = id;
    this.env = env;
  }

  input(event: string, fields: Record<string, unknown> = {}): string {
    const own: Record<string, Record<string, unknown>> = {
      'session-start': { is_background_agent: false, composer_mode: 'agent' },
      prompt: { prompt: 'go', attachments: [] },
      edit: { tool_name: 'Write', tool_use_id: 'call_1', tool_output: '{}', duration: 12, cwd: this.cwd },
      stop: { status: 'completed', loop_count: 0 },
    };
    const turn = event === 'session-start' ? {} : { conversation_id: this.id, generation_id: `g${Math.max(this.turns, 1)}` };
    return JSON.stringify({ ...turn, session_id: this.id, hook_event_name: CURSOR_EVENTS[event], cursor_version: '2026.11.22-e9042b2', workspace_roots: [this.cwd], user_email: null, transcript_path: null, ...own[event], ...fields });
  }

  run(event: string, fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return hook(this.bench, event, this.input(event, fields), { ...this.env, ...env }, undefined, { cwd: event === 'stop' ? this.cwd : PLUGIN });
  }

  start(): Promise<HookRun> {
    return this.run('session-start');
  }

  prompt(env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    this.turns++;
    return this.run('prompt', {}, env);
  }

  edit(path: string, tool = 'Write', fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return this.run('edit', { tool_name: tool, tool_input: { file_path: join(this.cwd, path), content: '' }, ...fields }, env);
  }

  stop(fields: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
    return this.run('stop', fields, env);
  }
}

// Runs the parts of a test at once, each on a bench of its own with a copy of one sample: the sample is made once, since making it starts git several times, and a copy of its folder starts nothing.
export async function withBenches(parts: [what: string, run: (bench: Bench, s: string, dir: string) => Promise<void>][]): Promise<void> {
  await inTemp(async (base) => {
    const sample = makeSample(base);
    await atOnce(parts, parts.length, ([what]) => what, ([, run]) =>
      withBench(async (bench, dir) => {
        const s = join(dir, 's');
        cpSync(sample, s, { recursive: true });
        // git holds the inode and times of each file in its index, which a copy changes; refreshed here, the index is not rewritten by the first git command of a hook, which the harness would take for a change the run made.
        git(s, 'update-index', '-q', '--refresh');
        await run(bench, s, dir);
      }),
    );
  });
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

export type Deadlines = Record<'session-start' | 'prompt' | 'edit' | 'stop', number>;

// A stand-in lawcheck that starts a child, writes both process ids to a file and never answers; with trap, both stay alive on SIGTERM, so only the SIGKILL 2 seconds later ends them.
function hangingLawcheck(bench: Bench, pids: string, trap: boolean): void {
  // A shell wherever one can stand in: the process ids must be written before the hook's deadline, and a new node on a loaded macOS runner took longer than 5 seconds to write them.
  if (!WINDOWS) {
    bench.shell('lawcheck', [...(trap ? ["trap '' TERM"] : []), '/bin/sleep 300 </dev/null >/dev/null 2>&1 &', `echo "$$ $!" > '${pids}'`, 'wait']);
    return;
  }
  const ignore = trap ? "process.on('SIGTERM', () => {}); " : '';
  bench.script('lawcheck', [
    `const c = spawn(process.execPath, ['-e', ${JSON.stringify(`${ignore}setTimeout(() => {}, 300000)`)}], { stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(pids)}, process.pid + ' ' + c.pid);`,
    `${ignore}setTimeout(() => {}, 300000);`,
  ]);
}

function within(run: HookRun, seconds: number): void {
  assert.ok(run.ms >= seconds * 1000, `the hook ended after ${run.ms} ms, before its deadline of ${seconds} seconds`);
  assert.ok(run.ms < seconds * 1000 + HOOK_PAST_DEADLINE_MS, `the hook ended after ${run.ms} ms, past its deadline of ${seconds} seconds and ${HOOK_PAST_DEADLINE_MS} ms`);
}

function hangBench(dir: string) {
  const pids = join(dir, 'pids');
  fakeWrites(dir, ['pids']);
  const gone = async () => {
    assert.ok(existsSync(pids), 'the stand-in lawcheck did not start before the deadline');
    const [a, b] = readFileSync(pids, 'utf8').trim().split(' ').map(Number);
    assert.ok(await ended(a!, b!), `${a} ${b}`);
    rmSync(pids);
  };
  return { pids, gone };
}

// docs/plugin.md: the session-start hook, whose lawcheck prime never answers, and the prompt hook, whose git never answers, each end at its own deadline. With deadlines given, the hooks run with them in place of the shipped ones. Each hook has its own bench and sample, so the two deadlines pass at once and not one after the other.
export async function startAndPromptScenario(deadlines: Deadlines | null): Promise<void> {
  const start = deadlines?.['session-start'] ?? DEADLINES['session-start'];
  const prompt = deadlines?.prompt ?? DEADLINES.prompt;
  const options = deadlines === null ? {} : { deadlines };
  const hooks: [event: string, run: (bench: Bench, s: string, dir: string) => Promise<void>][] = [
    ['session-start', async (bench, s, dir) => {
      const { pids, gone } = hangBench(dir);
      hangingLawcheck(bench, pids, false);
      const started = await new Session(bench, s, 's1', {}, options).start();
      within(started, start);
      json(started, { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `This repository has a Lawcheck law (.lawcheck/law.yaml), and lawcheck prime did not run: it did not finish within ${start} seconds.\nInstall it with npm i -g lawcheck@alpha, then start a new session. Until then, read .lawcheck/law.yaml for the law.` } });
      await gone();
    }],
    ['prompt', async (bench, s, dir) => {
      const calls = join(dir, 'git.log');
      fakeWrites(dir, ['git.log']);
      const env = fakeGit(bench.bin, where('git'), { hang: true, record: { file: calls, variable: 'GIT_OPTIONAL_LOCKS' } });
      const prompted = await new Session(bench, s, 's1', env, options).prompt();
      within(prompted, prompt);
      nothing(prompted, 'prompt');
      assert.deepEqual(bench.sessions(), ['s1.json']);
      assert.equal(bench.state().open, false);
      assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line)), [{ words: ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], value: '0' }]);
      removeFakeGit(bench.bin);
    }],
  ];
  await withBenches(hooks);
}

// Test 163: a stand-in lawcheck that never answers, run by the edit hook and by the stop hook to their deadlines, then by an edit hook stopped by SIGTERM. The edit hook's stand-in and its child stay alive on SIGTERM, so it ends only by the SIGKILL that follows. With deadlines given, the first two hooks run with them in place of the shipped ones; the third is the shipped hook, stopped once the stand-in has started, or after a fixed time.
export async function deadlineScenario(deadlines: Deadlines | null, sigterm: 'started' | 'after 2 seconds'): Promise<void> {
  const edit = deadlines?.edit ?? DEADLINES.edit;
  const stop = deadlines?.stop ?? DEADLINES.stop;
  const options = deadlines === null ? {} : { deadlines };
  // Each hook has its own bench and sample, so the deadlines pass at once and not one after the other.
  const hooks: [event: string, run: (bench: Bench, s: string, dir: string) => Promise<void>][] = [
    ['edit', async (bench, s, dir) => {
      write(s, D_PATH, D);
      const { pids, gone } = hangBench(dir);
      hangingLawcheck(bench, pids, true);
      const late = await new Session(bench, s, 's1', {}, options).edit(D_PATH);
      within(late, edit);
      json(late, edited(`Lawcheck: lawcheck check ./${D_PATH} did not finish within ${edit} seconds, so the hook stopped it.`));
      await gone();
    }],
    ['stop', async (bench, s, dir) => {
      const { pids, gone } = hangBench(dir);
      hangingLawcheck(bench, pids, false);
      const session = new Session(bench, s, 's1', {}, options);
      await session.prompt();
      write(s, D_PATH, D);
      const stopped = await session.stop();
      within(stopped, stop);
      json(stopped, { systemMessage: `Lawcheck: the check at the end of the turn did not run: it did not finish within ${stop} seconds.` });
      await gone();
    }],
  ];
  if (platformSkip('a hook stopped by SIGTERM') === null) {
    hooks.push(['an edit stopped by SIGTERM', async (bench, s, dir) => {
      write(s, D_PATH, D);
      const { pids, gone } = hangBench(dir);
      hangingLawcheck(bench, pids, false);
      const session = new Session(bench, s, 's1', {}, options);
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
    }]);
  }
  await withBenches(hooks);
}
