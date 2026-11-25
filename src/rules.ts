import { fork, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import type { TypeDef } from './law.js';
import { releaseProcess, watchProcess } from './programs.js';
import { safeText } from './output.js';
import { hide } from './keys.js';
import type { Readable } from 'node:stream';
import { cores, count, MESSAGE_CHARS, points, readError, RULES_RUN_MS, RUN_FINDINGS, RUN_MESSAGE_CHARS } from './limits.js';
import type { Reads, Serve } from './readers.js';
import type { ErrorItem } from './output.js';
import { RULES_DIR, RULES_LIB } from './setup.js';
import type { Read, ReviewerRule } from './setup.js';
import { trackedLinks, workTreeTop } from './files.js';
import { decode, isBinary } from './types.js';
import { step } from './progress.js';

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

// A rule that ended a shared runner with anything but findings runs once more alone, and what it prints there is dropped: the user has read it from the first run, as it came.
function relay(stream: Readable | null, quiet: boolean): void {
  if (stream === null) return;
  let pending = '';
  const write = (text: string) => {
    if (!quiet) process.stderr.write(text);
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending += chunk;
    const end = pending.lastIndexOf('\n');
    if (end < 0) return;
    // A line ends at LF or CRLF, as Windows ends the lines Node and many programs print; a lone CR inside a line stays text, and is escaped.
    write(safeText(hide(pending.slice(0, end).split(/\r?\n/).join('\n').replace(/\r$/, ''))) + '\n');
    pending = pending.slice(end + 1);
  });
  stream.on('end', () => {
    if (pending !== '') write(safeText(hide(pending.replace(/\r$/, ''))) + '\n');
  });
}

export interface RawFinding {
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export interface MissingImport {
  specifier: string;
  url: string | null;
  parent: string | null;
}

export type Crash = { crash: string; missing?: MissingImport };

export type RuleOutcome = { findings: RawFinding[]; paths?: Map<string, string[]> } | Crash | { broken: string } | { slow: string };

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
  left?: boolean;
  what?: unknown;
  id?: unknown;
  missing?: unknown;
}

function missingImport(value: unknown): MissingImport | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { specifier, url, parent } = value as Record<string, unknown>;
  if (typeof specifier !== 'string' || (url !== null && typeof url !== 'string') || (parent !== null && typeof parent !== 'string')) return undefined;
  return { specifier, url, parent };
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
    if (message === undefined || message === null || message === '') return { problem: 'a finding without a message' };
    if (typeof message !== 'string') return { problem: `a finding whose message is ${valueName(message)}, not a string` };
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
  shared?: boolean;
  quiet?: boolean;
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

function startRunner(run: { root: string }, quiet = false): ChildProcess {
  const child = fork(RUNNER, [], {
    execArgv: runnerArgs(run.root),
    env: {},
    cwd: run.root,
    serialization: 'advanced',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  relay(child.stdout, quiet);
  relay(child.stderr, quiet);
  watchProcess(child);
  child.once('close', () => gone.add(child));
  // Between two rules of a runner no rule listens to it, and an error event nobody listens to would end the tool; the next rule finds the runner ended.
  child.on('error', () => undefined);
  return child;
}

const gone = new WeakSet<ChildProcess>();

// Ends a runner that no rule is using and waits as the end of a rule does: for the runner to close, or DRAIN_MS after it has ended.
function closeRunner(child: ChildProcess): Promise<void> {
  return new Promise((settle) => {
    releaseProcess(child);
    if (child.pid === undefined || gone.has(child)) return settle();
    let drain: NodeJS.Timeout | undefined;
    child.once('close', () => {
      clearTimeout(drain);
      settle();
    });
    const bounded = () => {
      drain = setTimeout(settle, DRAIN_MS);
    };
    if (child.exitCode !== null || child.signalCode !== null) bounded();
    else child.once('exit', bounded);
  });
}

export function runRule(run: RuleRun): Promise<RuleOutcome> {
  return drive(run, null).then(({ outcome }) => outcome);
}

// A rule runs in a runner of its own (held is null), or as the next rule of a runner that other rules of the run used before it. A runner is kept for the next rule only after findings and only when the runner says the rule left nothing behind; any other end kills it, as the end of a rule's own runner does.
function drive(run: RuleRun, held: ChildProcess | null): Promise<{ outcome: RuleOutcome; runner: ChildProcess | null; timed?: boolean }> {
  const timeoutMs = run.timeoutMs ?? LIMITS.ruleMs;
  const budget = run.budget ?? new FindingBudget();
  const shared = run.shared === true;
  return new Promise((resolve, reject) => {
    const child = held ?? startRunner(run, run.quiet === true);
    let closed = gone.has(child);
    const onClose = () => {
      closed = true;
    };
    child.once('close', onClose);
    let settled = false;
    let started = held !== null;
    let clean = false;
    let timed = false;
    let timer: NodeJS.Timeout | undefined;
    let left = timeoutMs;
    let since = 0;
    let readAt = 0;
    let waiting: ((message: Message) => void) | null = null;
    let current: { file: RuleFile; serving: number; asked: Set<string> } | null = null;
    let stage = 'in its load';
    let leftover = false;
    const where = () => (leftover ? 'after a call that left work running' : stage);
    const findings: RawFinding[] = [];
    const paths = new Map<string, string[]>();

    const end = (outcome: RuleOutcome | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.signal?.removeEventListener('abort', stop);
      if (shared && clean && !(outcome instanceof Error) && 'findings' in outcome && !closed && child.connected) {
        child.off('close', onClose);
        child.off('error', onError);
        child.off('exit', onExit);
        child.off('internalMessage', onInternal);
        child.off('message', onMessage);
        return resolve({ outcome, runner: child });
      }
      releaseProcess(child);
      const settle = () => (outcome instanceof Error ? reject(outcome) : resolve({ outcome, runner: null, timed }));
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
        if (used >= left) {
          timed = true;
          return end({ crash: `passes ${timeoutMs / 1000} seconds ${where()}` });
        }
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
        if (error && !settled) end({ crash: `ends before answering ${where()}` });
      });
    };
    const judging = () => step(`judging the files for the ${run.entry === 'companion' ? 'companion of the reviewer rule' : 'script rule'} ${run.rule}`);
    const callNext = (index: number) => {
      const file = run.files[index];
      if (file === undefined) {
        stage = 'after its last call';
        ask({ kind: 'finish' }, (message) => {
          if (message.kind === 'finished') {
            clean = (message as { clean?: unknown }).clean === true;
            return end(run.entry === 'companion' ? { findings, paths } : { findings });
          }
          return end({ crash: `writes to the runner's channel ${stage}` });
        });
        return;
      }
      stage = `on ${file.path}`;
      judging();
      current = { file, serving: 0, asked: new Set() };
      const payload = { path: file.path, type: file.type?.id ?? null, text: file.text, lines: file.lines };
      ask({ kind: 'call', file: payload }, (message) => {
        leftover = message.left === true;
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
          judging();
          child.send({ kind: 'answer', id: message.id, value }, (error) => {
            if (error && !settled) end({ crash: `ends before answering ${where()}` });
          });
          if (--call.serving === 0) arm();
        },
        (error: unknown) => end(error instanceof Error ? error : new Error(String(error))),
      );
    };

    const load = () =>
      ask({ kind: 'load', file: run.ruleFile, rule: run.rule, filesOf: run.filesOf, entry: run.entry ?? 'check', limits: { messageChars: MESSAGE_CHARS, findings: RUN_FINDINGS, chars: RUN_MESSAGE_CHARS } }, (message) => {
        if (message.kind === 'load-failed') {
          const missing = missingImport(message.missing);
          return end({ crash: `fails to load: ${message.message}`, ...(missing === undefined ? {} : { missing }) });
        }
        if (message.kind === 'uncloneable') return end({ crash: `fails to load: ${message.message}` });
        if (message.kind !== 'loaded') return end({ crash: `writes to the runner's channel ${stage}` });
        callNext(0);
      });

    const stop = () => end({ slow: slowMessage(`not finished ${stage}`) });
    run.signal?.addEventListener('abort', stop, { once: true });
    if (run.signal?.aborted) stop();
    const onError = (error: Error) => end(started ? error : { broken: `the runner of script rules did not start: ${error.message}` });
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      if (started) return end({ crash: `ends before answering ${where()}` });
      end({ broken: whyNotStarted(run.root, `it ended with ${code ?? signal} before it started`) });
    };
    // A rule can send a handle through the channel, its own standard error among them, with a message or with one of Node's internal messages, and the tool's copy would keep that pipe open.
    const onInternal = (_message: unknown, handle: unknown) => closeHandle(handle);
    const onMessage = (message: unknown, handle: unknown) => {
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
    };
    child.on('error', onError);
    child.on('exit', onExit);
    child.on('internalMessage', onInternal);
    child.on('message', onMessage);
    if (settled) return;
    if (held === null) return arm();
    if (child.exitCode !== null || child.signalCode !== null || !child.connected) return end({ crash: `ends before answering ${where()}` });
    load();
  });
}

// How long the rules of a run share the runners they have before more start: a runner takes about half of this to start, so the rules of a small check stay in one, and slow rules have twice the runners after each step, up to the limit.
const RUNNER_STEP_MS = 75;

export interface RuleTask {
  run: RuleRun;
  notStarted?: () => RuleOutcome | null;
}

// The rules of a run go through few runners, each taking one whole rule after another, so a run of many rules starts far fewer processes than it has rules. Findings are taken from a runner that rules share, and so is a rule that passed its time limit there, since no other rule runs in that runner while it does and a second run would make the user wait twice. After any other end the rule runs once more in a runner of its own, and that result stands, so a crash or a wrong return names its rule exactly as it does alone. The findings of a rule count toward the run only once the rule has ended.
export async function runRules(tasks: RuleTask[], limit = cores()): Promise<RuleOutcome[]> {
  const results: RuleOutcome[] = new Array(tasks.length);
  let next = 0;
  let lanes = 0;
  let done = false;
  let more: NodeJS.Timeout | undefined;
  const all: Promise<void>[] = [];
  let failure: unknown = null;
  const lane = async () => {
    let runner: ChildProcess | null = null;
    try {
      while (next < tasks.length) {
        const index = next++;
        const { run, notStarted } = tasks[index]!;
        const early = notStarted?.() ?? null;
        if (early !== null) {
          results[index] = early;
          continue;
        }
        const own = new FindingBudget();
        const tried: { outcome: RuleOutcome; runner: ChildProcess | null; timed?: boolean } = await drive({ ...run, budget: own, shared: true }, runner);
        runner = tried.runner;
        if ('findings' in tried.outcome) {
          const kept = tried.outcome.findings;
          let chars = 0;
          for (const finding of kept) chars += points(finding.message);
          const into: RawFinding[] = [];
          const budget = run.budget ?? new FindingBudget();
          budget.take(run.rule, into, kept);
          if (own.total > kept.length || own.chars > chars) budget.take(run.rule, into, { count: own.total - kept.length, chars: own.chars - chars });
          results[index] = { ...tried.outcome, findings: into };
        } else if ('crash' in tried.outcome && tried.timed !== true && !run.signal?.aborted) results[index] = await runRule({ ...run, quiet: true });
        else results[index] = tried.outcome;
      }
    } finally {
      if (runner !== null) await closeRunner(runner);
    }
  };
  const open = () => {
    for (let add = Math.max(lanes, 1); add > 0; add--) {
      if (done || next >= tasks.length || lanes >= Math.min(limit, tasks.length)) return;
      lanes++;
      all.push(
        lane().catch((error: unknown) => {
          failure ??= error ?? new Error('a runner of script rules failed');
        }),
      );
    }
    more = setTimeout(open, RUNNER_STEP_MS);
  };
  open();
  try {
    for (let at = 0; at < all.length; at++) await all[at];
  } finally {
    done = true;
    clearTimeout(more);
  }
  if (failure !== null) throw failure;
  return results;
}

// A rule whose load read a package in a node_modules outside the root needs that package installed below the root, not a change of its file.
export function crashNext(crash: string, again = 'lawcheck check'): string | undefined {
  const found = /^fails to load: reads .*[\\/]node_modules[\\/]((?:@[^\\/\s]+[\\/])?[^\\/\s]+)/.exec(crash);
  return found === null ? undefined : `install ${found[1]!.replace(/\\/g, '/')} in a node_modules below the root, then run ${again}`;
}

export interface CopyOfRules {
  folder: string;
  ref: string;
  again: string;
}

// Under --law-from a rule loads from a copy of the commit's rules that the run then removes, so a crash names its files as the commit holds them, and its fix belongs to that commit: the work tree's rule may load well.
export function crashError(file: string, outcome: Crash, copy?: CopyOfRules): ErrorItem {
  if (copy === undefined) {
    const next = crashNext(outcome.crash);
    return { code: 'rule-crashed', file, line: null, message: outcome.crash, ...(next === undefined ? {} : { next }) };
  }
  const tops = copyTops(copy.folder);
  const missing = outcome.missing;
  const target = missing === undefined ? null : inCopy(tops, missing.url);
  const module = missing === undefined ? null : inCopy(tops, missing.parent);
  if (missing !== undefined && target !== null && module !== null && !target.startsWith(RULES_DIR)) {
    return {
      code: 'rule-crashed',
      file,
      line: null,
      message: `fails to load: ${module} of '${copy.ref}' imports '${missing.specifier}', which leads to ${target}, outside ${RULES_DIR}, and under --law-from a rule of '${copy.ref}' loads only the files of ${RULES_DIR} of '${copy.ref}'`,
      next: `on '${copy.ref}', copy what ${module} needs of ${target} into ${RULES_LIB} and import it from there by a relative path, then run ${copy.again}`,
    };
  }
  const message = outsideCopy(outcome.crash, tops);
  return { code: 'rule-crashed', file, line: null, message, next: crashNext(message, copy.again) ?? `fix ${file} on '${copy.ref}', then run ${copy.again}` };
}

// Node names a module by its real path, which differs from the copy's path when the root lies below a link, as the temporary folders of macOS do.
function copyTops(folder: string): string[] {
  try {
    const real = realpathSync(folder);
    return real === folder ? [folder] : [folder, real];
  } catch {
    return [folder];
  }
}

function inCopy(tops: string[], url: string | null): string | null {
  if (url === null) return null;
  let path: string;
  try {
    path = fileURLToPath(url);
  } catch {
    return null;
  }
  for (const top of tops) {
    const inside = relative(top, path);
    if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) return inside.split(sep).join('/');
  }
  return null;
}

function outsideCopy(text: string, tops: string[]): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = text;
  for (const top of tops) {
    out = out.replace(new RegExp(`${escape(top + sep)}([^'"\\s]*)`, 'g'), (_, rest: string) => rest.split(sep).join('/'));
    out = out.replace(new RegExp(`${escape(`${pathToFileURL(top).href}/`)}([^'"\\s]*)`, 'g'), (_, rest: string) => {
      try {
        return decodeURI(rest);
      } catch {
        return rest;
      }
    });
  }
  return out;
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
  modules?: string;
  files: string[];
  read: Read;
  filesOf: Map<string, string[]>;
  serve: Reads;
  signal?: AbortSignal;
  copy?: CopyOfRules;
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
  const ran = await runRules(
    wanted.map(({ rule, files }) => ({
      run: { root: run.root, rule, ruleFile: join(run.modules ?? run.root, reviewers.get(rule)!.companion!.path), files, filesOf: run.filesOf, signal, serve: run.serve(files, `the companion of the reviewer rule ${rule}`), entry: 'companion' as const },
      notStarted: () => (signal.aborted ? { slow: slowMessage('not started') } : null),
    })),
  );
  const outcomes = wanted.map(({ rule, files }, at) => ({ rule, files, outcome: ran[at]! }));
  own?.clear();
  const listed = new Set(run.files);
  const companions: Companions = new Map();
  const errors: ErrorItem[] = [];
  for (const { rule, files, outcome } of outcomes) {
    const reviewer = reviewers.get(rule)!;
    const module = reviewer.companion!.path;
    if ('broken' in outcome) return { errors: [{ code: 'runner-failed', file: null, line: null, message: outcome.broken }] };
    if ('crash' in outcome) {
      errors.push(crashError(module, outcome, run.copy));
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

function linkError(link: { path: string; target: string }): ErrorItem {
  return { code: 'link-outside-root', file: link.path, line: null, message: `the link leads to ${link.target}, outside the git work tree and Lawcheck's folder, and a script rule could read through it` };
}

export function runnerErrors(root: string): ErrorItem[] {
  const unsupported = runnerProblem(root);
  if (unsupported !== null) return [{ code: 'path-unsupported', file: null, line: null, message: unsupported }];
  return linksOut(root, workTreeTop(root), trackedLinks(root)).map(linkError);
}

export function tooManyFindings(budget: FindingBudget): ErrorItem[] {
  const all = `the rules of a run may return ${count(RUN_FINDINGS)} findings with ${count(RUN_MESSAGE_CHARS)} characters of message in all, and they returned ${count(budget.total)} with ${count(budget.chars)}`;
  const items: ErrorItem[] = [];
  for (const [rule, own] of budget.byRule) {
    if (own.count === 0) continue;
    items.push({ code: 'too-many-findings', file: `${RULES_DIR}${rule}.mjs`, line: null, message: `returns ${count(own.count)} findings with ${count(own.chars)} characters of message in this run; ${all}` });
  }
  return items;
}
