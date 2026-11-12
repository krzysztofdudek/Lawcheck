import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import type { TypedFile } from './types.js';

export const RUNNER = fileURLToPath(new URL('./runner.js', import.meta.url));
export const PACKAGE_DIR = realpathSync(dirname(dirname(RUNNER)));
export const TIMEOUT_MS = 30_000;

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

export function validate(rule: string, value: unknown, file: TypedFile): { findings: RawFinding[] } | { problem: string } {
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
  files: TypedFile[];
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
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let waiting: ((message: Message) => void) | null = null;
    let stage = 'in its load';
    const findings: RawFinding[] = [];

    const end = (outcome: RuleOutcome | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
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
      const payload = { path: file.path, type: file.type.id, text: file.text, lines: file.lines };
      ask({ kind: 'call', file: payload }, (message) => {
        if (message.kind === 'threw') return end({ crash: `throws on ${file.path}: ${message.message}` });
        if (message.kind === 'uncloneable') {
          return end({ crash: `returns a value the channel cannot carry for ${file.path}: ${message.message}` });
        }
        if (message.kind !== 'result') return end({ crash: `answers ${file.path} with something the runner does not send` });
        const checked = validate(run.rule, message.value, file);
        if ('problem' in checked) return end({ crash: `returns ${checked.problem} for ${file.path}` });
        findings.push(...checked.findings);
        callNext(index + 1);
      });
    };

    child.on('error', (error) => end(error));
    child.on('exit', () => end({ crash: `ends before answering ${stage}` }));
    child.on('message', (message: Message) => waiting?.(message));
    ask({ kind: 'load', file: run.ruleFile, filesOf: run.filesOf }, (message) => {
      if (message.kind === 'load-failed') return end({ crash: `fails to load: ${message.message}` });
      if (message.kind === 'uncloneable') return end({ crash: `fails to load: ${message.message}` });
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
