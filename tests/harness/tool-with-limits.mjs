import { createRequire, syncBuiltinESMExports } from 'node:module';
import { isMainThread, workerData } from 'node:worker_threads';
import { LIMITS } from '../../dist/rules.js';

// startTool of tests/harness/start.ts passes the limits of a test as JSON in this variable; it is removed before the tool runs, so neither the tool nor what it starts sees it.
const NAME = 'LAWCHECK_TEST_LIMITS';
// The command runs in a worker, whose modules, LIMITS among them, are its own: the tool's worker starts from this file, which sets the same limits there before it loads the worker's own entry.
const KEY = 'lawcheckTestLimits';

function problem(given) {
  if (given === null || typeof given !== 'object' || Object.keys(given).length === 0) return `${NAME} names no limit`;
  for (const [name, value] of Object.entries(given)) {
    if (!Object.hasOwn(LIMITS, name)) return `${NAME} names ${name}, which is no limit of the tool`;
    if (typeof value !== 'number' || !(value > 0) || value >= LIMITS[name]) return `${NAME} gives ${name} ${value}, and a test limit is shorter than the shipped ${LIMITS[name]}`;
  }
  return null;
}

if (isMainThread) {
  const given = JSON.parse(process.env[NAME] ?? 'null');
  delete process.env[NAME];
  // A refusal is one line on standard error, written before the process ends: an uncaught error would print the source line, which a Windows checkout ends with CR.
  const refused = problem(given);
  if (refused !== null) {
    process.stderr.write(`${refused}\n`);
    process.exitCode = 1;
  } else {
    Object.assign(LIMITS, given);
    const threads = createRequire(import.meta.url)('node:worker_threads');
    const Worker = threads.Worker;
    const self = new URL(import.meta.url);
    threads.Worker = class extends Worker {
      constructor(file, options = {}) {
        super(self, { ...options, workerData: { ...options.workerData, [KEY]: { given, file: String(file) } } });
      }
    };
    syncBuiltinESMExports();
    await import('../../dist/bin.cjs');
  }
} else {
  const { given, file } = workerData[KEY];
  Object.assign(LIMITS, given);
  await import(file);
}
