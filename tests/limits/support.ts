import { spawn } from 'node:child_process';
import type { StdioOptions } from 'node:child_process';
import { closeSync, ftruncateSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLI, GIT_ENV } from '../acceptance/helpers.ts';
import { startTool } from '../harness/tool.ts';
import type { Expect, Run } from '../harness/tool.ts';
import * as NUMBERS from '../numbers.ts';

export const MiB = 1024 * 1024;

export interface RunOptions extends Expect {
  env?: NodeJS.ProcessEnv;
  node?: string[];
}

// Through the harness, so every run is checked whole; the time a run took is printed and never asserted, so a slow system shows as a number and not as a red.
export async function run(cwd: string, args: string[], options: RunOptions = {}): Promise<Run> {
  const result = await startTool(cwd, args, GIT_ENV, options).ended;
  if (options.budget !== undefined) process.stdout.write(`# ${args.join(' ')}: ${result.ms} ms of a budget of ${(NUMBERS as Record<string, unknown>)[options.budget]} ms\n`);
  return result;
}

export interface Own {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

// A start the harness cannot make: a standard output that is a file descriptor of the test, or one a shell closes. It starts the package's bin, as a user's shell does.
export const BIN = join(dirname(CLI), 'bin.js');

export function ownStart(cwd: string, args: string[], stdout: StdioOptions[number], redirect: string | null = null): Promise<Own> {
  const [program, words] = redirect === null ? [process.execPath, [BIN, ...args]] : ['/bin/sh', ['-c', `exec "$0" "$@" ${redirect}`, process.execPath, BIN, ...args]];
  return new Promise((resolve, reject) => {
    const child = spawn(program, words, { cwd, env: GIT_ENV, stdio: ['ignore', stdout, 'pipe'] });
    let out = '';
    let err = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout: out, stderr: err }));
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
