import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetNamed, KILLED_GRACE_MS, LEFTOVER_GRACE_MS, RUN_BUDGET_MS } from '../numbers.ts';
import { Broken, hasInternal, jsonProblem, outputProblem, stringsOf } from './invariants.ts';
import { killAll, MARK, Tracker } from './processes.ts';
import { harnessSkip } from './skips.ts';
import { gitChanges, gitState, gitTop, real, tree, treeChanges } from './state.ts';
import type { GitState } from './state.ts';

export const ROOT_DIR = real(fileURLToPath(new URL('../..', import.meta.url)));
export const ROOT = ROOT_DIR + sep;
export const CLI = join(ROOT_DIR, 'dist', 'cli.js');
export const HOOK = join(ROOT_DIR, 'plugin', 'hooks', 'lawcheck-hook.mjs');
const WINDOWS = process.platform === 'win32';

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
  // Paths relative to the test's temporary folder, outside the repository, that the test's own fakes write while the run lasts.
  outside?: (string | RegExp)[];
  repo?: string;
  budget?: string;
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
  output(pattern: RegExp, where?: 'stdout' | 'stderr'): Promise<RegExpExecArray>;
  kill(signal?: NodeJS.Signals): void;
  readonly ended: Promise<Run>;
}

// A program is a test program of this repository (the stability measurement, the agent trial, the real repositories): it reports on standard error in its own words, and invariants 2 to 5 are promises of Lawcheck's own output.
type Kind = 'cli' | 'hook' | 'program';

interface Start {
  kind: Kind;
  // A shell that starts the installed lawcheck by its name; without one, Node runs argv.
  shell?: { program: string; verbatim: boolean };
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  own: NodeJS.ProcessEnv;
  stdin?: string;
  args: string[];
}

export interface Observer {
  budget(): number;
  folders(): string[];
  fakes(folder: string): (string | RegExp)[];
  started(): void;
  compared(): void;
  failed(error: Error): void;
  pending(ended: Promise<unknown>): void;
}

let observer: Observer | null = null;

// Open while the harness itself starts a run, so the guard of tests/harness/tool.ts lets that one start through.
export const gate = { open: 0 };

export function observe(next: Observer | null): void {
  observer = next;
}

export function compared(): void {
  observer?.compared();
}

function observed(raw: { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; json: unknown; ms: number }): Run {
  const run = {} as Run;
  for (const key of ['code', 'signal', 'stdout', 'stderr', 'json'] as const) {
    Object.defineProperty(run, key, {
      enumerable: true,
      get() {
        observer?.compared();
        return raw[key];
      },
    });
  }
  Object.defineProperty(run, 'ms', { enumerable: true, value: raw.ms });
  return run;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lawRoot(cwd: string, top: string): string {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.lawcheck', 'law.yaml'))) return dir;
    if (dir === top || dirname(dir) === dir) return cwd;
  }
}

function prefixOf(dir: string, top: string): string {
  const rel = relative(top, dir).split(sep).join('/');
  return rel === '' ? '' : `${rel}/`;
}

// The files and folders each command writes by contract: init, spec/commands-slice.md, section 3; check --review, spec/reviewer-slice.md, section 5.
function contractWrites(start: Start, top: string): (string | RegExp)[] {
  if (start.kind !== 'cli') return [];
  const cwd = real(start.cwd);
  const command = start.args[0];
  if (command === 'init') {
    const p = prefixOf(cwd, top);
    return [new RegExp(`^${escape(p)}\\.lawcheck/(law\\.yaml|\\.gitignore)$`), `=${p}.lawcheck/`];
  }
  if (command === 'check' && start.args.includes('--review')) {
    const p = prefixOf(lawRoot(cwd, top), top);
    return [new RegExp(`^${escape(p)}\\.lawcheck/(verdicts|\\.gitattributes|\\.local/\\.gitignore|\\.local/failures/[0-9a-f]{32}\\.json)$`), `=${p}.lawcheck/.local/`, `=${p}.lawcheck/.local/failures/`];
  }
  return [];
}

// spec/reviewer-slice.md, section 6: before its calls the tool writes one line to standard error with the number of calls and the provider; spec/questions.md, question 18, fixes its words.
const CALLS_LINE = /^(lawcheck: \d+ reviewer calls? to (anthropic|openai|google|openai-compatible|ollama|claude-code|codex|gemini-cli|copilot-cli)\n)?$/;

function contractStderr(start: Start): RegExp | null {
  if (start.kind !== 'cli') return null;
  if ((start.args[0] === 'check' && start.args.includes('--review')) || start.args[0] === 'try') return CALLS_LINE;
  return null;
}

// A rule is a path, a folder ending in / and everything in it, a pattern, or = and a folder that may appear itself, empty or not.
function allowed(path: string, rules: (string | RegExp)[]): boolean {
  return rules.some((rule) => (typeof rule !== 'string' ? rule.test(path) : rule.startsWith('=') ? rule.slice(1) === path : rule === path || (rule.endsWith('/') && path.startsWith(rule))));
}

function inside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder + sep);
}

// A hook works in the folder its input names, or, when that is no folder of the test (cwd "/"), beside its plugin data.
function folderOf(start: Start, expect: Expect): string {
  if (expect.repo !== undefined) return expect.repo;
  if (start.kind !== 'hook') return start.cwd;
  const candidates: string[] = [];
  try {
    const input = JSON.parse(start.stdin ?? '') as { cwd?: unknown };
    if (typeof input.cwd === 'string') candidates.push(input.cwd);
  } catch {
    candidates.push(start.cwd);
  }
  if (start.env.CLAUDE_PLUGIN_DATA) candidates.push(dirname(start.env.CLAUDE_PLUGIN_DATA));
  const existing = candidates.filter((path) => existsSync(path)).map(real);
  return existing.find((path) => observer?.folders().some((f) => inside(path, f))) ?? existing[0] ?? start.cwd;
}

interface Scope {
  folder: string | null;
  top: string | null;
  runs: number;
  tree: Map<string, string> | null;
  git: GitState | null;
  writes: (string | RegExp)[];
  outside: (string | RegExp)[];
}

const scopes = new Map<string, Scope>();

// Every run folder made in this process stays known: on Windows a program the guard started may still write in one after its run.
const runFolders = new Set<string>();
const notRunFolder = (root: string) => (name: string) => runFolders.has(join(root, name));

function open(start: Start, expect: Expect): Scope {
  const where = real(folderOf(start, expect));
  const folder = observer?.folders().find((f) => inside(where, f)) ?? null;
  if (observer !== null && folder === null && !inside(where, ROOT_DIR)) throw new Error(`harness: the run works in ${where}, which is no folder of this test; make its folder with testFolder() of tests/harness/tool.ts`);
  const found = gitTop(where);
  const top = found === null || found === ROOT_DIR ? null : found;
  const key = folder ?? top ?? `run ${randomBytes(4).toString('hex')}`;
  let scope = scopes.get(key);
  if (scope === undefined) {
    scope = { folder, top, runs: 0, tree: folder === null ? null : tree(folder, notRunFolder(folder)), git: top === null ? null : gitState(top), writes: [], outside: [] };
    scopes.set(key, scope);
  }
  scope.runs++;
  if (top !== null) scope.writes.push(...contractWrites(start, top));
  scope.writes.push(...(expect.writes ?? []));
  scope.outside.push(...(expect.outside ?? []), ...(folder === null ? [] : (observer?.fakes(folder) ?? [])));
  (scope as Scope & { key?: string }).key = key;
  return scope;
}

function close(scope: Scope): [string, string][] {
  scope.runs--;
  if (scope.runs > 0) return [];
  scopes.delete((scope as Scope & { key?: string }).key!);
  const problems: [string, string][] = [];
  if (scope.top !== null && scope.git !== null) {
    const changes = gitChanges(scope.git, gitState(scope.top));
    const files = changes.paths.filter((path) => !path.endsWith('/'));
    const unexpected = files.filter((path) => !allowed(path, scope.writes));
    const folders = changes.paths
      .filter((path) => path.endsWith('/'))
      .filter((dir) => !allowed(dir, scope.writes) && !files.some((file) => file.startsWith(dir) && allowed(file, scope.writes)));
    const parts = [...changes.parts, ...unexpected, ...folders];
    if (parts.length > 0) problems.push(['harness-7', `the run changed ${parts.slice(0, 10).join(', ')} in ${scope.top}`]);
  }
  if (scope.folder !== null && scope.tree !== null) {
    const top = scope.top;
    const outside = treeChanges(scope.tree, tree(scope.folder, notRunFolder(scope.folder))).filter((path) => (top === null || !inside(join(scope.folder!, path), top)) && !allowed(path, scope.outside));
    if (outside.length > 0) problems.push(['harness-8', `the run changed ${outside.slice(0, 10).join(', ')} in the test's folder ${scope.folder}, outside the repository`]);
  }
  return problems;
}

function runFolder(base: string | null): { dir: string; home: string; temp: string } {
  const dir = real(mkdtempSync(base !== null ? join(base, '.run-') : join(tmpdir(), 'lawcheck-run-')));
  runFolders.add(dir);
  const home = join(dir, 'home');
  const temp = join(dir, 'tmp');
  mkdirSync(home);
  mkdirSync(temp);
  return { dir, home, temp };
}

function placed(env: NodeJS.ProcessEnv, own: NodeJS.ProcessEnv, home: string, temp: string): NodeJS.ProcessEnv {
  const out = { ...env };
  const set = (names: string[], value: string) => {
    if (names.some((name) => name in own)) return;
    for (const name of names) out[name] = value;
  };
  set(['TMPDIR', 'TMP', 'TEMP'], temp);
  set(['HOME', 'USERPROFILE'], home);
  // Windows programs keep their caches under LOCALAPPDATA (the guard's PowerShell writes its startup data there), so it stays the machine's; APPDATA, where a program keeps what it was told, moves into the home.
  if (WINDOWS) set(['APPDATA'], join(home, 'AppData', 'Roaming'));
  set(['XDG_CONFIG_HOME'], join(home, '.config'));
  set(['XDG_CACHE_HOME'], join(home, '.cache'));
  set(['XDG_DATA_HOME'], join(home, '.local', 'share'));
  return out;
}

function waitEmpty(dir: string, until: number): Promise<string[]> {
  return new Promise((done) => {
    const look = () => {
      const left = existsSync(dir) ? readdirSync(dir) : [];
      if (left.length === 0 || Date.now() >= until) done(left);
      else setTimeout(look, 20);
    };
    look();
  });
}

function killTree(pid: number): void {
  try {
    if (WINDOWS) spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      return;
    }
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
  } catch {
    return true;
  }
}

const CATCHABLE: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

function launch(start: Start, expect: Expect): Running {
  if (start.kind === 'cli' && start.shell === undefined) {
    const cli = start.argv[start.argv.length - start.args.length - 1]!;
    if (!existsSync(cli)) throw new CouldNotRun(`${cli} is missing; run npm run build`);
  }
  const budget = expect.budget !== undefined ? budgetNamed(expect.budget) : (observer?.budget() ?? RUN_BUDGET_MS);
  const scope = open(start, expect);
  const own = runFolder(scope.folder);
  const mark = randomBytes(8).toString('hex');
  const env = { ...placed(start.env, start.own, own.home, own.temp), [MARK]: mark };
  const began = Date.now();
  gate.open++;
  let child;
  try {
    child = spawn(start.shell?.program ?? process.execPath, start.argv, { cwd: start.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: !WINDOWS, windowsVerbatimArguments: start.shell?.verbatim ?? false });
  } finally {
    gate.open--;
  }
  if (child.pid === undefined) {
    close(scope);
    throw new Error(`harness: ${start.argv.join(' ')} did not start`);
  }
  const pid = child.pid;
  const tracker = new Tracker(pid, mark, [own.dir, ...(scope.folder ? [scope.folder] : []), ...(scope.top ? [scope.top] : [])], !harnessSkip('no process of the run is left alive'));
  let stdout = '';
  let stderr = '';
  const bytes: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] };
  const live = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  let sent: NodeJS.Signals | null = null;
  let overran = false;
  const waiting: { pattern: RegExp; where: 'stdout' | 'stderr'; done: (m: RegExpExecArray) => void }[] = [];
  const notify = () => {
    for (const w of [...waiting]) {
      const m = w.pattern.exec(w.where === 'stdout' ? stdout : stderr);
      if (m !== null) {
        waiting.splice(waiting.indexOf(w), 1);
        w.done(m);
      }
    }
  };
  child.stdout.on('data', (chunk: Buffer) => {
    bytes.stdout.push(chunk);
    stdout += live.stdout.write(chunk);
    notify();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    bytes.stderr.push(chunk);
    stderr += live.stderr.write(chunk);
    notify();
  });
  child.stdin.on('error', () => {});
  child.stdin.end(start.stdin ?? '');
  // The timer can fire late, after the run has ended, when the harness was busy with other runs; only a run still alive then has overrun.
  let closed = false;
  const overrun = () => {
    overran = true;
    killTree(pid);
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const timer = setTimeout(() => {
    if (running(pid)) overrun();
    else setTimeout(() => !closed && overrun(), KILLED_GRACE_MS).unref();
  }, budget);
  observer?.started();
  const ended = new Promise<Run>((resolve, reject) => {
    child.on('error', (error) => {
      clearTimeout(timer);
      tracker.stop();
      reject(error);
    });
    child.on('close', (code, signal) => {
      closed = true;
      finish(code, signal).catch((error: unknown) => {
        const broken = new Error(`harness: finishing the run failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        observer?.failed(broken);
        reject(broken);
      });
    });
    const finish = async (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      const ms = Date.now() - began;
      tracker.stop();
      stdout += live.stdout.end();
      stderr += live.stderr.end();
      // PowerShell writes the lines of a program it runs with CRLF; the tool wrote LF, and only those bytes are its output.
      if (start.shell !== undefined && WINDOWS) {
        stdout = stdout.replace(/\r\n/g, '\n');
        stderr = stderr.replace(/\r\n/g, '\n');
      }
      for (const w of waiting.splice(0)) w.done(Object.assign([''], { index: -1, input: '' }) as RegExpExecArray);
      const problems: [string, string][] = [];
      const killed = sent !== null || overran;
      const until = Date.now() + (killed ? KILLED_GRACE_MS : LEFTOVER_GRACE_MS);
      const alone = scope.runs === 1;
      let left = tracker.alive(alone);
      while (left.length > 0 && Date.now() < until) {
        await new Promise((done) => setTimeout(done, 20));
        left = tracker.alive(alone);
      }
      if (left.length > 0) {
        problems.push(['harness-6', `alive ${killed ? KILLED_GRACE_MS : LEFTOVER_GRACE_MS} ms after the run ended: ${tracker.describe(left)}`]);
        killAll(left);
      }
      if (overran) problems.push(['harness-6', `the run did not end within its budget of ${budget} ms`]);
      const caught = sent !== null && CATCHABLE.includes(sent) && !harnessSkip('a signal the test sent ends the run as the spec says');
      if (signal !== null && !overran && !(sent === 'SIGKILL' && signal === 'SIGKILL') && !(sent !== null && signal === sent && !caught)) problems.push(['harness-1', `the run died by ${signal}${caught ? `; spec/check-slice.md, section 3, and spec/questions.md, question 56, say a caught ${sent} ends with an exit code` : ''}`]);
      if (code !== null && ![0, 1, 2].includes(code)) problems.push(['harness-1', `exit code ${code}`]);
      if (caught && signal === null) {
        if (start.kind === 'cli' && code !== 2) problems.push(['harness-1', `after ${sent} the tool exited with ${code}; spec/check-slice.md, section 3, says a caught signal ends it as internal, exit 2`]);
        if (start.kind === 'hook' && (code !== 0 || stdout !== '')) problems.push(['harness-1', `after ${sent} the hook exited with ${code} and printed ${JSON.stringify(stdout.slice(0, 100))}; spec/questions.md, question 56, says it exits 0 with nothing printed`]);
      }
      let document: unknown;
      if (start.kind === 'cli' && start.args.includes('--json') && !overran && signal === null && !caught) {
        const found = jsonProblem(stdout, code);
        document = found.document;
        if (found.problem !== null) problems.push(['harness-3', found.problem]);
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
        for (const where of ['stdout', 'stderr'] as const) {
          try {
            new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(bytes[where]));
          } catch {
            problems.push(['harness-2', `standard ${where === 'stdout' ? 'output' : 'error'} is not valid UTF-8`]);
          }
        }
        const texts: [string, string][] = [['standard error', stderr]];
        if (start.kind === 'cli' && document === undefined) texts.push(['standard output', stdout]);
        if (start.kind === 'hook' && document !== undefined) for (const text of stringsOf(document)) texts.push(['a string of the hook output', text]);
        for (const [where, text] of texts) {
          const problem = outputProblem(text);
          if (problem !== null) problems.push(['harness-2', `${where}: ${problem}`]);
        }
        const internal = start.kind === 'cli' ? hasInternal(stdout, document) : stringsOf(document).some((text) => hasInternal(text, undefined)) || hasInternal(stderr, undefined);
        if (internal && !expect.internal && !(caught && start.kind === 'cli')) problems.push(['harness-5', `the run ended with internal: ${JSON.stringify((document === undefined ? stdout : JSON.stringify(document)).slice(0, 300))}`]);
      }
      const byContract = contractStderr(start);
      const matches = (expected: string | RegExp) => (typeof expected === 'string' ? stderr === expected : expected.test(stderr));
      if (expect.stderr !== undefined) {
        if (!matches(expect.stderr)) problems.push(['harness-4', `standard error is ${JSON.stringify(stderr.slice(0, 300))}, expected ${expect.stderr}`]);
      } else if (start.kind !== 'program' && stderr !== '' && !(byContract !== null && byContract.test(stderr))) {
        problems.push(['harness-4', `standard error is not empty: ${JSON.stringify(stderr.slice(0, 300))}`]);
      }
      const leftTemp = await waitEmpty(own.temp, Date.now() + (killed ? KILLED_GRACE_MS : LEFTOVER_GRACE_MS));
      if (leftTemp.length > 0) problems.push(['harness-8', `the run left ${leftTemp.slice(0, 10).join(', ')} in its temporary directory`]);
      // Windows makes the folders of a profile (AppData\\Local\\Microsoft\\...) for a program that asks where one is, PowerShell among them; there only a file in the home counts.
      const written = [...tree(own.home).keys()].filter((path) => !WINDOWS || !path.endsWith('/'));
      if (written.length > 0) problems.push(['harness-8', `the run wrote ${written.slice(0, 10).join(', ')} in its home folder`]);
      rmSync(own.dir, { recursive: true, force: true, maxRetries: 10 });
      problems.push(...close(scope));
      const raw = { code, signal, stdout, stderr, json: start.kind === 'hook' ? (document ?? null) : document, ms };
      if (problems.length > 0) {
        const detail = problems.map(([id, text]) => `${id}: ${text}`).join('\n') + `\nthe run: ${start.args.join(' ')} in ${start.cwd}\nexit ${code}${signal ? ` by ${signal}` : ''}\nstdout: ${JSON.stringify(stdout.slice(0, 2000))}\nstderr: ${JSON.stringify(stderr.slice(0, 2000))}`;
        const error = new Broken(problems[0]![0], detail.slice(detail.indexOf(':') + 2));
        observer?.failed(error);
        reject(error);
        return;
      }
      resolve(observed(raw));
    };
  });
  ended.catch(() => {});
  observer?.pending(ended);
  return {
    pid,
    stdout: () => stdout,
    stderr: () => stderr,
    output(pattern: RegExp, where: 'stdout' | 'stderr' = 'stderr') {
      const m = pattern.exec(where === 'stdout' ? stdout : stderr);
      if (m !== null) return Promise.resolve(m);
      return new Promise((done) => waiting.push({ pattern, where, done }));
    },
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

export function startTool(cwd: string, args: string[], base: NodeJS.ProcessEnv, options: ToolOptions = {}): Running {
  const cli = options.cli ?? CLI;
  const own = options.env ?? {};
  return launch({ kind: 'cli', argv: [...(options.node ?? []), cli, ...args], cwd, env: { ...base, ...own }, own, stdin: options.stdin, args }, options);
}

export function startHook(event: string, input: string, env: NodeJS.ProcessEnv, options: Expect & { hook?: string; cwd?: string } = {}): Running {
  return launch({ kind: 'hook', argv: [options.hook ?? HOOK, event], cwd: options.cwd ?? ROOT_DIR, env, own: env, stdin: input, args: [event] }, options);
}

const TOOL_FILES = [CLI, HOOK, join(ROOT_DIR, 'plugin', 'hooks')];

export function startProgram(script: string, args: string[], cwd: string, base: NodeJS.ProcessEnv, options: Expect & { env?: NodeJS.ProcessEnv } = {}): Running {
  const path = real(script);
  if (TOOL_FILES.some((file) => inside(path, file)) || /[\\/]dist[\\/]/.test(path) || path.endsWith('.tgz')) throw new Error(`harness: ${script} is Lawcheck itself; start it with startTool or startHook`);
  const own = options.env ?? {};
  return launch({ kind: 'program', argv: [path, ...args], cwd, env: { ...base, ...own }, own, args: [path, ...args] }, options);
}

export type Shell = 'sh' | 'PowerShell' | 'cmd' | 'Git Bash';

function shellOf(shell: Shell, line: string): { program: string; argv: string[]; verbatim: boolean } {
  if (shell === 'sh') return { program: 'sh', argv: ['-c', line], verbatim: false };
  if (shell === 'Git Bash') return { program: join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'), argv: ['-c', line], verbatim: false };
  if (shell === 'PowerShell') return { program: 'powershell.exe', argv: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', line], verbatim: false };
  return { program: process.env.ComSpec ?? 'cmd.exe', argv: ['/d', '/c', line], verbatim: true };
}

// The installed lawcheck started by its bare name from a shell, as a user types the line, with every check of a run of the tool.
export function startShell(shell: Shell, line: string, cwd: string, base: NodeJS.ProcessEnv, options: Expect & { env?: NodeJS.ProcessEnv } = {}): Running {
  const words = line.split(' ');
  if (words[0] !== 'lawcheck') throw new Error(`harness: a shell line starts lawcheck by its name, and "${line}" does not`);
  const { program, argv, verbatim } = shellOf(shell, line);
  const own = options.env ?? {};
  return launch({ kind: 'cli', shell: { program, verbatim }, argv, cwd, env: { ...base, ...own }, own, args: words.slice(1) }, options);
}

// npm on Windows is a .cmd file, which execFile cannot start; under npm, npm_execpath names npm's own script, which Node starts everywhere.
function npm(args: string[], cwd: string): string {
  const program = process.env.npm_execpath ? process.execPath : WINDOWS ? 'npm.cmd' : 'npm';
  const all = process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  return execFileSync(program, all, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: !process.env.npm_execpath && WINDOWS });
}

// The packed tarball, unpacked into a folder of the test with the checkout's node_modules beside it: the files a user installs, started as the package's bin.
export function unpackTarball(folder: string): string {
  if (!existsSync(CLI)) throw new CouldNotRun(`${CLI} is missing; run npm run build`);
  const packed = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', folder], ROOT_DIR)) as { filename: string }[];
  const tarball = join(folder, packed[0]!.filename);
  execFileSync('tar', ['-xzf', tarball, '-C', folder], { stdio: 'ignore' });
  rmSync(tarball);
  const dir = join(folder, 'package');
  symlinkSync(join(ROOT_DIR, 'node_modules'), join(dir, 'node_modules'), WINDOWS ? 'junction' : 'dir');
  return join(dir, 'dist', 'cli.js');
}
