import { fork, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { realpathSync, rmSync } from 'node:fs';
import type { TypeDef } from './law.js';
import { killTree } from './programs.js';

export interface RuleFile {
  path: string;
  type: TypeDef | null;
  text: string;
  lines: string[];
}

export const RUNNER = fileURLToPath(new URL('./runner.js', import.meta.url));
export const PACKAGE_DIR = realpathSync(dirname(dirname(RUNNER)));
export const TIMEOUT_MS = 30_000;
const GUARD = fileURLToPath(new URL('./guard.js', import.meta.url));

const live = new Set<ChildProcess>();
const liveGroups = new Set<number>();
const liveFolders = new Set<string>();
let guard: ChildProcess | null = null;

function startGuard(): void {
  if (guard === null) {
    guard = spawn(process.execPath, [GUARD], { cwd: dirname(GUARD), stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    guard.on('error', () => undefined);
    guard.stdin!.on('error', () => undefined);
    guard.unref();
    (guard.stdin as unknown as { unref(): void }).unref();
  }
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

export interface RawFinding {
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export type RuleOutcome = { findings: RawFinding[] } | { crash: string };

interface Message {
  kind: string;
  message?: string;
  value?: unknown;
}

export function normalizeMessage(message: string): string {
  return message.replace(/\r\n|[\n\r]/g, ' ');
}

export function validate(rule: string, value: unknown, file: RuleFile): { findings: RawFinding[] } | { problem: string } {
  if (!Array.isArray(value)) return { problem: 'no list' };
  const findings: RawFinding[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return { problem: 'a finding that is no object' };
    const { message, file: path, line } = item as { message?: unknown; file?: unknown; line?: unknown };
    if (typeof message !== 'string' || message === '') return { problem: 'a finding without a message' };
    if (path !== undefined && path !== file.path) return { problem: `a finding about '${String(path)}'` };
    if (line !== undefined && !(Number.isInteger(line) && (line as number) >= 1 && (line as number) <= file.lines.length)) {
      return { problem: `a finding at line ${String(line)}, outside lines 1 to ${file.lines.length}` };
    }
    const finding: RawFinding = { rule, file: file.path, message: normalizeMessage(message) };
    if (line !== undefined) finding.line = line as number;
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
}

export function runRule(run: RuleRun): Promise<RuleOutcome> {
  const timeoutMs = run.timeoutMs ?? TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = fork(RUNNER, [], {
      execArgv: ['--permission', `--allow-fs-read=${run.root}`, `--allow-fs-read=${PACKAGE_DIR}`],
      env: {},
      cwd: run.root,
      serialization: 'advanced',
      stdio: ['ignore', 2, 2, 'ipc'],
    });
    watch(child);
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let waiting: ((message: Message) => void) | null = null;
    let stage = 'in its load';
    const findings: RawFinding[] = [];

    const end = (outcome: RuleOutcome | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      release(child);
      const settle = () => (outcome instanceof Error ? reject(outcome) : resolve(outcome));
      // Windows refuses to remove the root while the killed runner, which works in it, is still ending.
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) settle();
      else child.once('exit', settle);
    };
    const ask = (request: unknown, onAnswer: (message: Message) => void) => {
      timer = setTimeout(() => end({ crash: `passes ${timeoutMs / 1000} seconds ${stage}` }), timeoutMs);
      waiting = (message) => {
        clearTimeout(timer);
        waiting = null;
        onAnswer(message);
      };
      child.send(request as object, (error) => {
        if (error && !settled) end({ crash: `ends before answering ${stage}` });
      });
    };
    const callNext = (index: number) => {
      const file = run.files[index];
      if (file === undefined) {
        end({ findings });
        return;
      }
      stage = `on ${file.path}`;
      const payload = { path: file.path, type: file.type?.id ?? null, text: file.text, lines: file.lines };
      ask({ kind: 'call', file: payload }, (message) => {
        if (message.kind === 'threw') return end({ crash: `throws on ${file.path}: ${message.message}` });
        if (message.kind === 'uncloneable') {
          return end({ crash: `returns a value the channel cannot carry for ${file.path}: ${message.message}` });
        }
        if (message.kind !== 'result') return end({ crash: `writes to the runner's channel ${stage}` });
        const checked = validate(run.rule, message.value, file);
        if ('problem' in checked) return end({ crash: `returns ${checked.problem} for ${file.path}` });
        findings.push(...checked.findings);
        callNext(index + 1);
      });
    };

    child.on('error', (error) => end(error));
    child.on('exit', () => end({ crash: `ends before answering ${stage}` }));
    child.on('message', (message: unknown) => {
      const known = typeof message === 'object' && message !== null && typeof (message as Message).kind === 'string';
      if (waiting === null || !known) return end({ crash: `writes to the runner's channel ${stage}` });
      waiting(message as Message);
    });
    ask({ kind: 'load', file: run.ruleFile, filesOf: run.filesOf }, (message) => {
      if (message.kind === 'load-failed') return end({ crash: `fails to load: ${message.message}` });
      if (message.kind === 'uncloneable') return end({ crash: `fails to load: ${message.message}` });
      if (message.kind !== 'loaded') return end({ crash: `writes to the runner's channel ${stage}` });
      callNext(0);
    });
  });
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
