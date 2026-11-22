import { closeSync, ftruncateSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GIT_ENV } from '../acceptance/helpers.ts';
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

// A head of 8,000 bytes without a NUL makes the file text, whatever follows.
export function textHead(firstLine: string): string {
  const line = 'export const a = 1;\n';
  let head = firstLine;
  while (head.length < 8000) head += line;
  return head;
}

export function errorLines(stdout: string): string[] {
  return stdout.split('\n').filter((line) => /(^|  )error\[[a-z0-9-]+\]  /.test(line));
}
