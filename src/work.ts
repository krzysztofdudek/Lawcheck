import { parentPort, workerData } from 'node:worker_threads';
import { main } from './cli.js';
import { alive, attach, step } from './progress.js';

const { argv, cwd, progress } = workerData as { argv: string[]; cwd: string; progress: SharedArrayBuffer };
attach(progress);
step('starting');
setInterval(alive, 1000).unref();
const warn = (line: string) => parentPort!.postMessage({ kind: 'warn', line });
const result = await main(argv, { cwd, env: process.env, warn });
step('writing the result');
const stdout = new TextEncoder().encode(result.stdout);
parentPort!.postMessage({ kind: 'done', code: result.code, stdout }, [stdout.buffer]);
