import { parentPort, workerData } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import { gitThroughMainThread } from './files.js';
import { main } from './main.js';
import { alive, attach, step } from './progress.js';

const { argv, cwd, progress, git, gitFlag } = workerData as { argv: string[]; cwd: string; progress: SharedArrayBuffer; git: MessagePort; gitFlag: SharedArrayBuffer };
attach(progress);
// The worker's own standard error reaches the main thread by another channel than its result, so a line written just before the end could be lost; on the channel of the result it comes first.
process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  parentPort!.postMessage({ kind: 'stderr', text: typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk) });
  const done = rest.find((item) => typeof item === 'function') as (() => void) | undefined;
  done?.();
  return true;
}) as typeof process.stderr.write;
gitThroughMainThread(git, gitFlag);
step('starting');
setInterval(alive, 1000).unref();
const warn = (line: string) => parentPort!.postMessage({ kind: 'warn', line });
const result = await main(argv, { cwd, env: process.env, warn });
step('writing the result');
const stdout = new TextEncoder().encode(result.stdout);
parentPort!.postMessage({ kind: 'done', code: result.code, stdout }, [stdout.buffer]);
