import { fork, spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import type { TypeDef } from './law.js';
import { killTree } from './programs.js';
import { safeText } from './output.js';
import { hide } from './keys.js';
import type { Readable } from 'node:stream';
import { count, MESSAGE_CHARS, points, readError, RULES_RUN_MS, RUN_FINDINGS, RUN_MESSAGE_CHARS } from './limits.js';
import type { Serve } from './readers.js';
import type { ErrorItem } from './output.js';
import type { Read, ReviewerRule } from './setup.js';
import { decode, isBinary } from './types.js';

export interface RuleFile {
  path: string;
  type: TypeDef | null;
  text: string;
  lines: string[];
}

export const RUNNER = fileURLToPath(new URL('./runner.js', import.meta.url));
export const PACKAGE_DIR = realpathSync(dirname(dirname(RUNNER)));
// docs/script-rules.md: 30 seconds for the load and for each call. Only a test changes it, from an entry of its own that sets it before it starts the tool; no option, variable or file a user controls reaches it, and a rule runs in a process of its own, which cannot.
export const LIMITS = { ruleMs: 30_000 };
// How long a run waits, after its runner has ended, for the runner's pipes to close. No program the tool starts can hold them, because every program but git starts on the worker thread, as the runners do, and git starts on the main thread only while the worker waits for it, so no other program starts while a runner's pipe ends can be inherited; starting another program on the main thread would break this on Windows. A rule starts no program, and the tool closes every handle a runner sends. A program from outside the tool can still hold a pipe, as a runner file put in place of this package's own can leave one; the bound keeps it from holding the run. The R-114 test's late writer, one Node start and 2 seconds, must fit inside the bound, and the tests of a handle sent through the channel tell the bound from an end at once.
const DRAIN_MS = 10_000;
const GUARD = fileURLToPath(new URL('./guard.js', import.meta.url));

const live = new Set<ChildProcess>();
const liveGroups = new Set<number>();
const liveFolders = new Set<string>();
let guard: ChildProcess | null = null;
let listing = false;

function startGuard(): void {
  if (guard === null) {
    guard = spawn(process.execPath, [GUARD], { cwd: dirname(GUARD), stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    guard.on('error', () => undefined);
    guard.stdin!.on('error', () => undefined);
    guard.unref();
    (guard.stdin as unknown as { unref(): void }).unref();
  }
}

// On Windows the guard finds what a program started only in PowerShell's list of processes, and PowerShell takes seconds to start on a busy machine, so the guard starts its list as soon as the tool is about to call a program; a call does not wait for it, since reviewer.timeout bounds the whole call, and the guard ends a killed tool's tree from a list begun after the kill. PowerShell makes a missing temporary directory, and without one no program starts, as a call's folder is made there, so the list is then not started.
export function startListing(): void {
  if (process.platform !== 'win32' || listing || !existsSync(tmpdir())) return;
  listing = true;
  startGuard();
  guard!.stdin!.write('+w\n');
}

function watch(child: ChildProcess): void {
  if (child.pid === undefined) return;
  live.add(child);
  startGuard();
  guard!.stdin!.write(`+${child.pid}\n`);
}

export function killGroup(pid: number, signal: NodeJS.Signals): boolean {
  return killTree(pid, signal);
}

export function watchGroup(pid: number): void {
  liveGroups.add(pid);
  startGuard();
  guard!.stdin!.write(`+g${pid}\n`);
}

export function watchFolder(path: string): void {
  if (/[\r\n]/.test(path)) return;
  liveFolders.add(path);
  startGuard();
  guard!.stdin!.write(`+d${path}\n`);
}

// A folder made before the guard knows of it outlives a tool killed by SIGKILL in between, so the guard learns its name first and the folder is made after.
export function guardedFolder(prefix: string): string {
  for (let tries = 1; ; tries++) {
    const path = join(tmpdir(), `${prefix}${randomBytes(6).toString('hex')}`);
    watchFolder(path);
    try {
      mkdirSync(path, { mode: 0o700 });
      return path;
    } catch (error) {
      if (liveFolders.delete(path)) guard?.stdin?.write(`-d${path}\n`);
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || tries === 10) throw error;
    }
  }
}

export function releaseFolder(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 10 });
  if (liveFolders.delete(path)) guard?.stdin?.write(`-d${path}\n`);
}

export function releaseGroup(pid: number): void {
  killGroup(pid, 'SIGKILL');
  if (liveGroups.delete(pid)) guard?.stdin?.write(`-g${pid}\n`);
}

function release(child: ChildProcess): void {
  if (live.delete(child)) guard?.stdin?.write(`-${child.pid}\n`);
  child.kill('SIGKILL');
}

process.on('exit', () => {
  for (const child of live) child.kill('SIGKILL');
  for (const pid of liveGroups) killGroup(pid, 'SIGKILL');
  for (const path of liveFolders) rmSync(path, { recursive: true, force: true, maxRetries: 10 });
});

// Node's permission model reads a * in --allow-fs-read as a wildcard over everything after it, and refuses to import a module whose file URL holds an encoded backslash.
export function runnerProblem(root: string): string | null {
  for (const [what, path] of [['the root', root], ["Lawcheck's folder", PACKAGE_DIR]] as const) {
    if (path.includes('*')) return `${what} ${path} holds a *, which the runner of script rules reads as a wildcard, so a rule could read the folders beside it`;
    if (sep === '/' && path.includes('\\')) return `${what} ${path} holds a backslash, and the runner of script rules cannot load a rule from such a path`;
  }
  return null;
}

// Node's permission model follows a link, so a tracked link that leads out of the work tree would let a rule read where it leads.
export function linksOut(root: string, top: string, links: { name: string; bytes: Buffer }[]): { path: string; target: string }[] {
  const inside = (path: string, folder: string) => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
  const native = (path: string) => {
    try {
      return realpathSync.native(path);
    } catch {
      return path;
    }
  };
  const tree = native(top);
  const own = native(PACKAGE_DIR);
  const out: { path: string; target: string }[] = [];
  for (const link of links) {
    let target: string;
    try {
      // The native call takes the name as bytes; the other one decodes it first and loses a name that is not UTF-8.
      target = realpathSync.native(Buffer.concat([Buffer.from(root + sep), link.bytes]));
    } catch {
      continue;
    }
    if (!inside(target, tree) && !inside(target, own)) out.push({ path: link.name, target });
  }
  return out;
}

function relay(stream: Readable | null): void {
  if (stream === null) return;
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending += chunk;
    const end = pending.lastIndexOf('\n');
    if (end < 0) return;
    // A line ends at LF or CRLF, as Windows ends the lines Node and many programs print; a lone CR inside a line stays text, and is escaped.
    process.stderr.write(safeText(hide(pending.slice(0, end).split(/\r?\n/).join('\n').replace(/\r$/, ''))) + '\n');
    pending = pending.slice(end + 1);
  });
  stream.on('end', () => {
    if (pending !== '') process.stderr.write(safeText(hide(pending.replace(/\r$/, ''))) + '\n');
  });
}

export interface RawFinding {
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export type RuleOutcome = { findings: RawFinding[]; paths?: Map<string, string[]> } | { crash: string } | { broken: string } | { slow: string };

export function rulesDeadline(): { signal: AbortSignal; clear(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RULES_RUN_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export function slowMessage(where: string): string {
  return `had ${where} when the script rules of this run passed the ${RULES_RUN_MS / 1000} seconds they may take together`;
}

// The findings the rules of one run return, kept up to the limit and counted past it, so a run that passes it names every rule with its full count.
export class FindingBudget {
  total = 0;
  chars = 0;
  readonly byRule = new Map<string, { count: number; chars: number }>();

  take(rule: string, into: RawFinding[], findings: RawFinding[] | { count: number; chars: number }): void {
    let taken: { count: number; chars: number };
    if (Array.isArray(findings)) {
      let chars = 0;
      for (const finding of findings) chars += points(finding.message);
      taken = { count: findings.length, chars };
    } else taken = findings;
    this.total += taken.count;
    this.chars += taken.chars;
    const own = this.byRule.get(rule) ?? { count: 0, chars: 0 };
    this.byRule.set(rule, { count: own.count + taken.count, chars: own.chars + taken.chars });
    if (Array.isArray(findings) && !this.passed()) for (const finding of findings) into.push(finding);
  }

  passed(): boolean {
    return this.total > RUN_FINDINGS || this.chars > RUN_MESSAGE_CHARS;
  }

  // Findings that are not a rule's, such as a waiver's or a use's, count with the file they are about.
  addAt(count: number, chars: number): boolean {
    this.total += count;
    this.chars += chars;
    return this.passed();
  }
}

interface Message {
  kind: string;
  message?: string;
  value?: unknown;
  load?: boolean;
  count?: number;
  chars?: number;
  what?: unknown;
  id?: unknown;
}

function backgroundCrash(message: Message): RuleOutcome {
  return { crash: `fails in the background${message.load === true ? ' in its load' : ''}: ${message.message}` };
}

export function normalizeMessage(message: string): string {
  return message.replace(/\r\n|[\n\r]/g, ' ');
}

function valueName(value: unknown): string {
  if (typeof value === 'string') return `the string ${JSON.stringify(value.length > 20 ? `${value.slice(0, 20)}…` : value)}`;
  if (typeof value === 'bigint') return `the bigint ${value}n`;
  if (typeof value === 'number') return `the number ${String(value)}`;
  if (Array.isArray(value)) return 'a list';
  return `a value of type ${typeof value}`;
}

export function validate(rule: string, value: unknown, file: RuleFile): { findings: RawFinding[] } | { problem: string } {
  if (!Array.isArray(value)) return { problem: 'no list' };
  const findings: RawFinding[] = [];
  const lineCount = file.lines.length;
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return { problem: 'a finding that is no object' };
    const { message, file: path, line } = item as { message?: unknown; file?: unknown; line?: unknown };
    if (typeof message !== 'string' || message === '') return { problem: 'a finding without a message' };
    if (path !== undefined && path !== file.path) return { problem: `a finding about '${String(path)}'` };
    if (line !== undefined && line !== null) {
      if (!Number.isInteger(line)) return { problem: `a finding whose line is ${valueName(line)}, not an integer` };
      if (lineCount === 0) return { problem: `a finding at line ${line as number}, though the file has no lines,` };
      if ((line as number) < 1 || (line as number) > lineCount) return { problem: `a finding at line ${line as number}, outside lines 1 to ${lineCount}` };
    }
    const finding: RawFinding = { rule, file: file.path, message: normalizeMessage(message) };
    if (line !== undefined && line !== null) finding.line = line as number;
    findings.push(finding);
  }
  return { findings };
}

export interface RuleRun {
  root: string;
  rule: string;
  ruleFile: string;
  files: RuleFile[];
  filesOf: Map<string, string[]>;
  timeoutMs?: number;
  budget?: FindingBudget;
  signal?: AbortSignal;
  serve?: Serve;
  entry?: 'check' | 'companion';
}

function pathsOf(value: unknown): string[] | { problem: string } {
  if (!Array.isArray(value)) return { problem: 'no list of paths' };
  const paths: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') return { problem: 'a path that is no string' };
    paths.push(item);
  }
  return paths;
}

// Node's permission model does not reach node:sqlite (Node 24.0 to 26.13 at least), which opens, attaches and writes any database the user can, so the runner starts without it.
function runnerArgs(root: string): string[] {
  return ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${PACKAGE_DIR}`, '--no-experimental-sqlite'];
}

// The runner printed why it did not start on the tool's standard error; starting it once more without a channel, which a sound runner ends at once, gives that line to the message.
function whyNotStarted(root: string, ended: string): string {
  const probe = spawnSync(process.execPath, [...runnerArgs(root), RUNNER], { cwd: root, env: {}, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: 10_000 });
  const lines = (probe.stderr ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  const said = lines.find((line) => /^(\w*Error\b|node: )/.test(line)) ?? lines[0];
  return `the runner of script rules did not start: ${said ?? ended}`;
}

function closeHandle(handle: unknown): void {
  if (handle === undefined || handle === null) return;
  const held = handle as { destroy?(): void; close?(): void };
  if (held.destroy) held.destroy();
  else held.close?.();
}

// The tool reads what a rule asks for in its own thread, where it cannot take another rule's ask, and so cannot stop that rule's clock, until the read ends; the time any read takes therefore counts toward no call.
let reads = 0;
let readSince = 0;
let readMs = 0;

function readTime(): number {
  return readMs + (reads > 0 ? Date.now() - readSince : 0);
}

async function reading<T>(work: () => Promise<T>): Promise<T> {
  if (reads++ === 0) readSince = Date.now();
  try {
    return await work();
  } finally {
    if (--reads === 0) readMs += Date.now() - readSince;
  }
}

export function runRule(run: RuleRun): Promise<RuleOutcome> {
  const timeoutMs = run.timeoutMs ?? LIMITS.ruleMs;
  const budget = run.budget ?? new FindingBudget();
  return new Promise((resolve, reject) => {
    const child = fork(RUNNER, [], {
      execArgv: runnerArgs(run.root),
      env: {},
      cwd: run.root,
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    relay(child.stdout);
    relay(child.stderr);
    watch(child);
    let closed = false;
    child.once('close', () => {
      closed = true;
    });
    let settled = false;
    let started = false;
    let timer: NodeJS.Timeout | undefined;
    let left = timeoutMs;
    let since = 0;
    let readAt = 0;
    let waiting: ((message: Message) => void) | null = null;
    let current: { file: RuleFile; serving: number; asked: Set<string> } | null = null;
    let stage = 'in its load';
    const findings: RawFinding[] = [];
    const paths = new Map<string, string[]>();

    const end = (outcome: RuleOutcome | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.signal?.removeEventListener('abort', stop);
      release(child);
      const settle = () => (outcome instanceof Error ? reject(outcome) : resolve(outcome));
      // Windows refuses to remove the root while the killed runner, which works in it, is still ending; and a runner that has ended can still hold what it printed in its pipes, which the tool relays before the run goes on. A pipe can outlive the runner, so the wait ends DRAIN_MS after the runner has ended.
      if (child.pid === undefined || closed) return settle();
      let drain: NodeJS.Timeout | undefined;
      const bounded = () => {
        drain = setTimeout(settle, DRAIN_MS);
      };
      child.once('close', () => {
        clearTimeout(drain);
        settle();
      });
      if (child.exitCode !== null || child.signalCode !== null) bounded();
      else child.once('exit', bounded);
    };
    const spent = () => Date.now() - since - (readTime() - readAt);
    const arm = () => {
      since = Date.now();
      readAt = readTime();
      timer = setTimeout(() => {
        const used = spent();
        if (used >= left) return end({ crash: `passes ${timeoutMs / 1000} seconds ${stage}` });
        left -= used;
        arm();
      }, Math.max(left, 0));
    };
    const ask = (request: unknown, onAnswer: (message: Message) => void) => {
      left = timeoutMs;
      arm();
      waiting = (message) => {
        clearTimeout(timer);
        waiting = null;
        current = null;
        onAnswer(message);
      };
      child.send(request as object, (error) => {
        if (error && !settled) end({ crash: `ends before answering ${stage}` });
      });
    };
    const callNext = (index: number) => {
      const file = run.files[index];
      if (file === undefined) {
        stage = 'after its last call';
        ask({ kind: 'finish' }, (message) => {
          if (message.kind === 'finished') return end(run.entry === 'companion' ? { findings, paths } : { findings });
          return end({ crash: `writes to the runner's channel ${stage}` });
        });
        return;
      }
      stage = `on ${file.path}`;
      current = { file, serving: 0, asked: new Set() };
      const payload = { path: file.path, type: file.type?.id ?? null, text: file.text, lines: file.lines };
      ask({ kind: 'call', file: payload }, (message) => {
        if (message.kind === 'threw') return end({ crash: `throws on ${file.path}: ${message.message}` });
        if (message.kind === 'uncloneable') {
          return end({ crash: `returns a value the channel cannot carry for ${file.path}: ${message.message}` });
        }
        if (message.kind === 'too-many') {
          budget.take(run.rule, findings, { count: message.count!, chars: message.chars ?? 0 });
          return callNext(index + 1);
        }
        if (message.kind === 'too-long') {
          return end({ crash: `returns a message of ${count(message.count!)} characters for ${file.path}, and a message holds at most ${count(MESSAGE_CHARS)}` });
        }
        if (message.kind !== 'result') return end({ crash: `writes to the runner's channel ${stage}` });
        if (run.entry === 'companion') {
          const returned = pathsOf(message.value);
          if ('problem' in returned) return end({ crash: `returns ${returned.problem} for ${file.path}` });
          paths.set(file.path, returned);
          return callNext(index + 1);
        }
        const checked = validate(run.rule, message.value, file);
        if ('problem' in checked) return end({ crash: `returns ${checked.problem} for ${file.path}` });
        budget.take(run.rule, findings, checked.findings);
        callNext(index + 1);
      });
    };

    // The time Lawcheck takes to read what the rule asks for is not the rule's, so the call's clock stops while it reads.
    const serve = (message: Message) => {
      const call = current;
      // The runner asks for each at most once a call, so a second ask is the rule's own write to the channel, and each one would cost the tool a read while the call's clock stands still.
      if (call === null || run.serve === undefined || (message.what !== 'tree' && message.what !== 'uses') || call.asked.has(message.what)) return end({ crash: `writes to the runner's channel ${stage}` });
      call.asked.add(message.what);
      if (call.serving++ === 0) {
        clearTimeout(timer);
        left -= spent();
      }
      reading(() => run.serve!(message.what as 'tree' | 'uses', call.file)).then(
        (value) => {
          if (settled || current !== call) return;
          child.send({ kind: 'answer', id: message.id, value }, (error) => {
            if (error && !settled) end({ crash: `ends before answering ${stage}` });
          });
          if (--call.serving === 0) arm();
        },
        (error: unknown) => end(error instanceof Error ? error : new Error(String(error))),
      );
    };

    const load = () =>
      ask({ kind: 'load', file: run.ruleFile, filesOf: run.filesOf, entry: run.entry ?? 'check' }, (message) => {
        if (message.kind === 'load-failed') return end({ crash: `fails to load: ${message.message}` });
        if (message.kind === 'uncloneable') return end({ crash: `fails to load: ${message.message}` });
        if (message.kind !== 'loaded') return end({ crash: `writes to the runner's channel ${stage}` });
        callNext(0);
      });

    const stop = () => end({ slow: slowMessage(`not finished ${stage}`) });
    run.signal?.addEventListener('abort', stop, { once: true });
    if (run.signal?.aborted) stop();
    child.on('error', (error) => end(started ? error : { broken: `the runner of script rules did not start: ${error.message}` }));
    child.on('exit', (code, signal) => {
      if (settled) return;
      if (started) return end({ crash: `ends before answering ${stage}` });
      end({ broken: whyNotStarted(run.root, `it ended with ${code ?? signal} before it started`) });
    });
    // A rule can send a handle through the channel, its own standard error among them, with a message or with one of Node's internal messages, and the tool's copy would keep that pipe open.
    child.on('internalMessage', (_message: unknown, handle: unknown) => closeHandle(handle));
    child.on('message', (message: unknown, handle: unknown) => {
      closeHandle(handle);
      const known = typeof message === 'object' && message !== null && typeof (message as Message).kind === 'string';
      if (!started && known && (message as Message).kind === 'ready') {
        started = true;
        clearTimeout(timer);
        return load();
      }
      if (known && (message as Message).kind === 'background') return end(backgroundCrash(message as Message));
      if (known && (message as Message).kind === 'ask') return serve(message as Message);
      if (waiting === null || !known) return end({ crash: `writes to the runner's channel ${stage}` });
      waiting(message as Message);
    });
    arm();
  });
}

// A rule whose load read a package in a node_modules outside the root needs that package installed below the root, not a change of its file.
export function crashNext(crash: string): string | undefined {
  const found = /^fails to load: reads .*[\\/]node_modules[\\/]((?:@[^\\/\s]+[\\/])?[^\\/\s]+)/.exec(crash);
  return found === null ? undefined : `install ${found[1]!.replace(/\\/g, '/')} in a node_modules below the root, then run lawcheck check`;
}

export async function runAll<T>(tasks: (() => Promise<T>)[], limit = availableParallelism()): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export interface ContextFile {
  path: string;
  text: string;
}

export type Companions = Map<string, Map<string, ContextFile[]>>;

export interface CompanionRun {
  root: string;
  files: string[];
  read: Read;
  filesOf: Map<string, string[]>;
  serve: (bound: RuleFile[]) => Serve;
  signal?: AbortSignal;
}

// The prompt already holds the judged file and the rule's context, so a path the module returns again adds nothing to it.
function filesFor(run: CompanionRun, reviewer: ReviewerRule, file: RuleFile, paths: string[], listed: Set<string>): ContextFile[] | ErrorItem {
  const module = reviewer.companion!.path;
  const crashed = (message: string): ErrorItem => ({ code: 'rule-crashed', file: module, line: null, message });
  const seen = new Set([file.path, ...reviewer.context.map((item) => item.path)]);
  const out: ContextFile[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    const quoted = `'${path}'`;
    if (!listed.has(path)) return crashed(`returns ${quoted} for ${file.path}, which is no file git lists here`);
    let bytes: Uint8Array;
    try {
      bytes = run.read(path);
    } catch (error) {
      return readError(path, error);
    }
    if (isBinary(bytes)) return crashed(`returns ${quoted} for ${file.path}, which is binary`);
    out.push({ path, text: decode(bytes) });
  }
  return out;
}

// The caller first makes sure the runner can keep its limits (runnerProblem, linksOut). The module of each rule runs once over the files the rule judges, in a runner of its own as a script rule does, and gives each file the files that go into its prompt after the rule's context.
export async function resolveCompanions(run: CompanionRun, reviewers: Map<string, ReviewerRule>, bound: { rule: string; files: RuleFile[] }[]): Promise<{ companions: Companions } | { errors: ErrorItem[] }> {
  const wanted = bound.filter(({ rule, files }) => files.length > 0 && reviewers.get(rule)?.companion != null);
  if (wanted.length === 0) return { companions: new Map() };
  const own = run.signal === undefined ? rulesDeadline() : null;
  const signal = run.signal ?? own!.signal;
  const outcomes = await runAll(
    wanted.map(({ rule, files }) => async () => {
      const module = reviewers.get(rule)!.companion!.path;
      return { rule, files, outcome: signal.aborted ? { slow: slowMessage('not started') } : await runRule({ root: run.root, rule, ruleFile: join(run.root, module), files, filesOf: run.filesOf, signal, serve: run.serve(files), entry: 'companion' }) };
    }),
  );
  own?.clear();
  const listed = new Set(run.files);
  const companions: Companions = new Map();
  const errors: ErrorItem[] = [];
  for (const { rule, files, outcome } of outcomes) {
    const reviewer = reviewers.get(rule)!;
    const module = reviewer.companion!.path;
    if ('broken' in outcome) return { errors: [{ code: 'runner-failed', file: null, line: null, message: outcome.broken }] };
    if ('crash' in outcome) {
      const next = crashNext(outcome.crash);
      errors.push({ code: 'rule-crashed', file: module, line: null, message: outcome.crash, ...(next === undefined ? {} : { next }) });
      continue;
    }
    if ('slow' in outcome) {
      errors.push({ code: 'rules-too-slow', file: module, line: null, message: outcome.slow });
      continue;
    }
    const byFile = new Map<string, ContextFile[]>();
    for (const file of files) {
      const found = filesFor(run, reviewer, file, outcome.paths?.get(file.path) ?? [], listed);
      if (!Array.isArray(found)) {
        errors.push(found);
        break;
      }
      byFile.set(file.path, found);
    }
    companions.set(rule, byFile);
  }
  return errors.length > 0 ? { errors } : { companions };
}

export function contextOf(reviewer: ReviewerRule, companions: Companions, rule: string, path: string): ContextFile[] {
  const added = companions.get(rule)?.get(path);
  return added === undefined || added.length === 0 ? reviewer.context : [...reviewer.context, ...added];
}
