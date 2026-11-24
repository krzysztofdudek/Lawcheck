#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, MessageChannel, Worker } from 'node:worker_threads';

const GIT_OUTPUT_BYTES = 1 << 30;
import { COMMANDS } from './args.js';
import { hiddenJson, hide, useKeys } from './keys.js';
import { totalmem } from 'node:os';
import { availableNow, MEMORY_CHECK_MS, MEMORY_RESERVE_BYTES, memoryCase, mib, runBound, STEP_MEMORY_BYTES, STEP_MS } from './limits.js';
import type { MemoryCase } from './limits.js';
import { renderErrors, safeJson, safeText } from './output.js';
import type { ErrorItem } from './output.js';
import { lastStep, progressBuffer } from './progress.js';
import { absolutePath, NO_CURRENT_FOLDER, serveGuard } from './programs.js';

// Each case names a step the user can take: a file whose uses are read leaves the types with may_use, or the types of the rule that read them; a file read only for what it declares leaves the files git lists; a run or a machine short of memory gets more of it.
export function memoryError(found: Exclude<MemoryCase, null>, what: string, file: string | null, command: string): ErrorItem {
  const again = `then run lawcheck ${command} again`;
  const message = found === 'file' ? `the run grew by more than the ${mib(STEP_MEMORY_BYTES)} of memory one file may add while ${what}` : `the run passed the ${mib(runBound(totalmem()))} of memory it may hold while ${what}`;
  const asker = / for the (script rule|companion of the reviewer rule) ([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(what);
  const judging = asker === null ? null : `the types whose files the ${asker[1] === 'script rule' ? 'script' : 'reviewer'} rule ${asker[2]} judges`;
  if (found === 'file' && file !== null && what.startsWith('reading what')) {
    return { code: 'memory-too-large', file, line: null, message, next: `keep ${file} out of the files git lists here (git rm --cached, and a line in .gitignore), since Lawcheck reads it for what it declares, ${again}` };
  }
  if (found === 'file' && file !== null && judging !== null) {
    const call = what.startsWith('reading the tree') ? 'tree()' : 'uses()';
    const keep = asker![1] === 'script rule' ? 'keep the rule' : 'keep its companion';
    return { code: 'memory-too-large', file, line: null, message, next: `leave ${file} out of ${judging}, or ${keep} from calling ${call} on it, ${again}` };
  }
  if (found === 'file' && file !== null) {
    return { code: 'memory-too-large', file, line: null, message, next: `leave ${file} out of the types whose may_use is in force, ${again}` };
  }
  if (found === 'run') {
    return { code: 'memory-too-large', file: null, line: null, message, next: `narrow ${judging ?? 'the types whose may_use is in force'} in .lawcheck/law.yaml, or run Lawcheck where it may hold more memory, ${again}` };
  }
  return { code: 'memory-too-large', file: null, line: null, message: `the system had less than ${mib(MEMORY_RESERVE_BYTES)} of memory left while ${what}`, next: `free memory on this machine, or run Lawcheck where it has more, ${again}` };
}

function internal(error: unknown): ErrorItem {
  const text = error instanceof Error ? error.message : String(error);
  return { code: 'internal', file: null, line: null, message: text.split(/\r?\n/)[0] || 'an unknown failure' };
}

// macOS reports a write to a pipe whose reader closed as ENOTCONN, as well as EPIPE.
export function readerGone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPIPE' || code === 'ENOTCONN';
}

type FromWork = { kind: 'warn'; line: string } | { kind: 'stderr'; text: string } | { kind: 'done'; code: number; stdout: Uint8Array };

// The command runs in a worker, so a signal is answered while the command is busy in code that never yields, such as a regular expression.
export function start(): void {
  absolutePath(process.env);
  if (process.platform === 'win32') process.env[NO_CURRENT_FOLDER] = '1';
  useKeys(process.env);
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const named = (COMMANDS as readonly string[]).includes(argv[0] ?? '') ? argv[0]! : null;
  let writing = false;
  const gits = new Set<ChildProcess>();
  const gitFlag = new Int32Array(new SharedArrayBuffer(4));
  const exit = (code: number) => {
    for (const child of gits) child.kill('SIGKILL');
    process.exit(code);
  };
  // Outside Windows Node writes to a pipe without waiting for its reader, and what that reader has not taken is lost when the process exits. So a run exits only once its standard error has taken every line passed on to it. A run that fail() ends does not wait: its worker still runs, and would write a second result with another code.
  let unwritten = 0;
  let ended: number | null = null;
  let stopped = false;
  const passOn = (text: string) => {
    unwritten++;
    process.stderr.write(text, () => {
      unwritten--;
      if (unwritten === 0 && ended !== null) exit(ended);
    });
  };
  const end = (code: number) => {
    if (unwritten === 0 || stopped) return exit(code);
    ended = code;
  };
  const writeOut = (bytes: Uint8Array | string, code: number) => {
    writing = true;
    process.stdout.on('error', () => undefined);
    process.stdout.write(bytes, (error) => {
      if (!error || readerGone(error)) return end(code);
      const cause = (error as NodeJS.ErrnoException).code ?? 'an error';
      process.stderr.write(`error[file-unwritable]  standard output cannot be written (${cause}), so the result is lost\n`, () => exit(2));
    });
  };
  const fail = (item: ErrorItem) => {
    stopped = true;
    if (writing) {
      process.stderr.write(safeText(`error[${item.code}]  ${hide(item.message)}\n`), () => exit(2));
      return;
    }
    const text = renderErrors([item], json, named);
    writeOut(json ? safeJson(hiddenJson(text)) : safeText(text), 2);
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => {
      // The result is written whole, so its code stands; only lines that rules printed are left behind.
      if (ended !== null) return exit(ended);
      fail({ code: 'stopped', file: null, line: null, message: `stopped by ${signal}` });
    });
  }
  const progress = progressBuffer();
  const { port1, port2 } = new MessageChannel();
  port1.on('message', (request: { program: string; root: string; args: string[]; env: NodeJS.ProcessEnv; input?: Uint8Array }) => {
    const reply = (message: object, transfer: ArrayBuffer[] = []) => {
      port1.postMessage(message, transfer);
      Atomics.store(gitFlag, 0, 1);
      Atomics.notify(gitFlag, 0);
    };
    const child = spawn(request.program, request.args, { cwd: request.root, env: request.env, stdio: [request.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    gits.add(child);
    if (request.input !== undefined) {
      // A git that ends before it reads all its input closes the pipe; its status says why.
      child.stdin!.on('error', () => {});
      child.stdin!.end(request.input);
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let failed: { code: string | null; message: string } | null = null;
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > GIT_OUTPUT_BYTES && failed === null) {
        failed = { code: 'ENOBUFS', message: 'git printed more than 1 GiB' };
        child.kill('SIGKILL');
      }
      if (failed === null) into.push(chunk);
    };
    child.stdout!.on('data', collect(out));
    child.stderr!.on('data', collect(err));
    child.on('error', (error) => {
      failed ??= { code: (error as NodeJS.ErrnoException).code ?? null, message: error.message };
    });
    child.on('close', (status, signal) => {
      gits.delete(child);
      const stdout = new Uint8Array(Buffer.concat(out));
      const stderr = new Uint8Array(Buffer.concat(err));
      reply({ error: failed, status, signal, stdout, stderr }, [stdout.buffer, stderr.buffer]);
    });
  });
  port1.unref();
  const lines = new MessageChannel();
  const guardWritten = new SharedArrayBuffer(4);
  serveGuard(lines.port1, guardWritten);
  const worker = new Worker(new URL('./work.js', import.meta.url), {
    workerData: { argv, cwd: process.cwd(), progress, git: port2, gitFlag: gitFlag.buffer, guard: lines.port2, guardWritten },
    transferList: [port2, lines.port2],
    stdout: false,
    stderr: false,
  });
  const watch = setInterval(() => {
    const last = lastStep(progress);
    if (writing || Date.now() - last.at <= STEP_MS) return;
    clearInterval(watch);
    fail({ code: 'step-too-slow', file: null, line: null, message: `one step of the run took more than ${STEP_MS / 1000} seconds without an end: ${last.what}` });
  }, 1000);
  watch.unref();
  // A reader of uses can grow by megabytes a millisecond and cannot be stopped from within, so the memory of the whole process is read from here, often, and the run ends before the system ends it.
  const total = totalmem();
  let stepAt = -1;
  let stepRss = 0;
  const memory = setInterval(() => {
    if (writing) return;
    const rss = process.memoryUsage.rss();
    const last = lastStep(progress);
    if (last.at !== stepAt) {
      stepAt = last.at;
      stepRss = rss;
    }
    const found = memoryCase({ rss, stepGrowth: last.file === null ? null : rss - stepRss, available: availableNow(), total });
    if (found === null) return;
    clearInterval(memory);
    fail(memoryError(found, last.what, last.file, named ?? 'check'));
  }, MEMORY_CHECK_MS);
  memory.unref();
  worker.on('message', (message: FromWork) => {
    if (message.kind === 'warn') passOn(safeText(message.line) + '\n');
    else if (message.kind === 'stderr') passOn(message.text);
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

// The command and its modules load in the worker alone, so the handlers of the signals are in place before them; started as dist/cli.js or through dist/bin.cjs, this module loads no more, and a test that imports the command loads it here.
const here = fileURLToPath(import.meta.url);
const first = started();
const launched = isMainThread && (first === here || first === join(dirname(here), 'bin.cjs'));
if (launched && first === here) start();
const command: typeof import('./main.js') | null = launched ? null : await import('./main.js');
export const main = command?.main as typeof import('./main.js').main;
export const parseArguments = command?.parseArguments as typeof import('./main.js').parseArguments;
export const version = command?.version as typeof import('./main.js').version;
export type { Command, Handler, Result } from './main.js';
