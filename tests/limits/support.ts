import { spawn } from 'node:child_process';
import type { StdioOptions } from 'node:child_process';
import { closeSync, ftruncateSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLI, GIT_ENV } from '../acceptance/helpers.ts';

export const MiB = 1024 * 1024;

export interface Ran {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  ms: number;
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  stdout?: 'pipe' | number | 'ignore';
  budgetMs?: number;
}

// The run is killed at its budget, and the time it took is printed and never asserted, so a slow system shows as a number and not as a red.
export function run(cwd: string, args: string[], options: RunOptions = {}): Promise<Ran> {
  const started = Date.now();
  const stdio: StdioOptions = ['ignore', options.stdout ?? 'pipe', 'pipe'];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...GIT_ENV, ...options.env }, stdio });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const timer = options.budgetMs === undefined ? undefined : setTimeout(() => child.kill('SIGKILL'), options.budgetMs);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (options.budgetMs !== undefined) process.stdout.write(`# ${args.join(' ')}: ${ms} ms of a budget of ${options.budgetMs} ms\n`);
      resolve({ code, signal, stdout, stderr, ms });
    });
  });
}

// The bytes after the head are a hole: the file system stores nothing for them and reads them as zero bytes.
export function sparse(repo: string, path: string, head: string, size: number): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  const fd = openSync(full, 'w');
  try {
    if (head !== '') writeSync(fd, head);
    ftruncateSync(fd, size);
  } finally {
    closeSync(fd);
  }
}

// A head of 8,000 bytes without a NUL makes the file text under section 2 of spec/check-slice.md, whatever follows.
export function textHead(firstLine: string): string {
  const line = 'export const a = 1;\n';
  let head = firstLine;
  while (head.length < 8000) head += line;
  return head;
}

export function errorLines(stdout: string): string[] {
  return stdout.split('\n').filter((line) => /(^|  )error\[[a-z0-9-]+\]  /.test(line));
}
