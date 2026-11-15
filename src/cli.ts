#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, Worker } from 'node:worker_threads';
import { COMMANDS } from './args.js';
import { hiddenJson, hide, useKeys } from './keys.js';
import { STEP_MS } from './limits.js';
import { renderErrors, safeJson, safeText } from './output.js';
import type { ErrorItem } from './output.js';
import { lastStep, progressBuffer } from './progress.js';
import { absolutePath, NO_CURRENT_FOLDER } from './programs.js';

function internal(error: unknown): ErrorItem {
  const text = error instanceof Error ? error.message : String(error);
  return { code: 'internal', file: null, line: null, message: text.split(/\r?\n/)[0] || 'an unknown failure' };
}

type FromWork = { kind: 'warn'; line: string } | { kind: 'done'; code: number; stdout: Uint8Array };

// The command runs in a worker, so a signal is answered while the command is busy in code that never yields, such as a regular expression.
export function start(): void {
  absolutePath(process.env);
  if (process.platform === 'win32') process.env[NO_CURRENT_FOLDER] = '1';
  useKeys(process.env);
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const named = (COMMANDS as readonly string[]).includes(argv[0] ?? '') ? argv[0]! : null;
  let writing = false;
  const exit = (code: number) => process.exit(code);
  const writeOut = (bytes: Uint8Array | string, code: number) => {
    writing = true;
    process.stdout.on('error', () => undefined);
    process.stdout.write(bytes, (error) => {
      if (!error || (error as NodeJS.ErrnoException).code === 'EPIPE') return exit(code);
      const cause = (error as NodeJS.ErrnoException).code ?? 'an error';
      process.stderr.write(`error[file-unwritable]  standard output cannot be written (${cause}), so the result is lost\n`, () => exit(2));
    });
  };
  const fail = (item: ErrorItem) => {
    if (writing) {
      process.stderr.write(safeText(`error[${item.code}]  ${hide(item.message)}\n`), () => exit(2));
      return;
    }
    const text = renderErrors([item], json, named);
    writeOut(json ? safeJson(hiddenJson(text)) : safeText(text), 2);
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => fail({ code: 'stopped', file: null, line: null, message: `stopped by ${signal}` }));
  }
  const progress = progressBuffer();
  const worker = new Worker(new URL('./work.js', import.meta.url), { workerData: { argv, cwd: process.cwd(), progress }, stdout: false, stderr: false });
  const watch = setInterval(() => {
    const last = lastStep(progress);
    if (writing || Date.now() - last.at <= STEP_MS) return;
    clearInterval(watch);
    fail({ code: 'step-too-slow', file: null, line: null, message: `one step of the run took more than ${STEP_MS / 1000} seconds without an end: ${last.what}` });
  }, 1000);
  watch.unref();
  worker.on('message', (message: FromWork) => {
    if (message.kind === 'warn') process.stderr.write(safeText(message.line) + '\n');
    else writeOut(message.stdout, message.code);
  });
  worker.on('error', (error) => fail(internal(error)));
  worker.on('exit', () => {
    if (!writing) fail(internal(new Error('the command ended without a result')));
  });
}


function started(): string | null {
  try {
    return process.argv[1] === undefined ? null : realpathSync(process.argv[1]);
  } catch {
    return null;
  }
}

// The command and its modules load in the worker alone, so the handlers of the signals are in place before them; started as dist/cli.js or through dist/bin.js, this module loads no more, and a test that imports the command loads it here.
const here = fileURLToPath(import.meta.url);
const first = started();
const launched = isMainThread && (first === here || first === join(dirname(here), 'bin.js'));
if (launched && first === here) start();
const command: typeof import('./main.js') | null = launched ? null : await import('./main.js');
export const main = command?.main as typeof import('./main.js').main;
export const parseArguments = command?.parseArguments as typeof import('./main.js').parseArguments;
export const version = command?.version as typeof import('./main.js').version;
export type { Command, Handler, Result } from './main.js';
