#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { isMainThread, Worker } from 'node:worker_threads';
import { lastStep, progressBuffer, step } from './progress.js';
import { STEP_MS } from './limits.js';
import { pathToFileURL } from 'node:url';
import { check } from './check.js';
import type { CheckContext, CheckOptions, CheckOutcome } from './check.js';
import { firstLine } from './law.js';
import { renderErrors, renderReport, safeJson, safeText } from './output.js';
import { hide, useKeys } from './keys.js';
import { COMMANDS, number, PROGRAM_USAGE, readArguments, text, usageError, USAGE, version } from './args.js';
import type { Arguments, CommandName, Result } from './args.js';

export { version };
export type { Result };
import { init } from './init.js';
import { absolutePath, NO_CURRENT_FOLDER } from './programs.js';
import { prime } from './prime.js';
import { explain } from './explain.js';
import { tryRule } from './try.js';
import { docs } from './docs.js';
import { doctor } from './doctor.js';
import { environmentRefusal, gitNow, runtimeNow } from './environment.js';
import type { ErrorItem } from './output.js';


export type Command = (options: CheckOptions, context: CheckContext) => Promise<CheckOutcome>;


export function parseArguments(argv: string[]): { options: CheckOptions } | { problem: string } {
  const read = readArguments(argv);
  if ('problem' in read) return { problem: read.problem };
  if (read.arguments.command !== 'check') return { problem: `the command '${read.arguments.command}' is not check` };
  return checkOptions(read.arguments);
}

function checkOptions(args: Arguments): { options: CheckOptions } | { problem: string } {
  const review = args.flags.has('--review');
  if (args.words.length > 0 && ['--full', '--base', '--review', '--again', '--max-calls'].some((flag) => args.flags.has(flag))) {
    return { problem: 'paths go with --json alone' };
  }
  if (!review && args.flags.has('--again')) return { problem: 'the flag --again works only with --review' };
  if (!review && args.flags.has('--max-calls')) return { problem: 'the flag --max-calls works only with --review' };
  return { options: { full: args.flags.has('--full'), base: text(args, '--base'), review, again: args.flags.has('--again'), maxCalls: number(args, '--max-calls'), paths: args.words } };
}

function internal(error: unknown): ErrorItem {
  return { code: 'internal', file: null, line: null, message: firstLine(error) || 'an unknown failure' };
}

export type Handler = (args: Arguments, context: CheckContext, json: boolean) => Promise<Result>;

const HANDLERS: Record<Exclude<CommandName, 'check'>, Handler> = { init, prime, explain, try: tryRule, docs, doctor };

export async function main(argv: string[], context: CheckContext, command: Command = check): Promise<Result> {
  useKeys(context.env);
  const result = await run(argv, context, command);
  return { ...result, stdout: argv.includes('--json') ? safeJson(hiddenJson(result.stdout)) : safeText(result.stdout) };
}

// The fields of a document that hold text from outside Lawcheck; its own fields, such as schema, code, the ids and the counts, stay as they are.
const OUTSIDE_FIELDS = new Set(['file', 'files', 'message', 'base', 'path', 'paths', 'reason', 'what', 'candidates', 'answer', 'text', 'about', 'pattern', 'content', 'why', 'model']);

// The key written as [key] in the strings of the outside fields; the layout is the one every document has.
function hiddenJson(text: string): string {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return text;
  }
  const masked = (value: unknown): unknown => (typeof value === 'string' ? hide(value) : Array.isArray(value) ? value.map(masked) : value);
  const walk = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(walk) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, OUTSIDE_FIELDS.has(name) ? masked(item) : walk(item)])) : value;
  return JSON.stringify(walk(document), null, 2) + '\n';
}

async function run(argv: string[], context: CheckContext, command: Command): Promise<Result> {
  const json = argv.includes('--json');
  const named = (COMMANDS as readonly string[]).includes(argv[0] ?? '') ? argv[0]! : null;
  try {
    if (argv.length === 1 && argv[0] === '--version') return { code: 0, stdout: version() + '\n' };
    if (argv.length === 1 && argv[0] === '--help') return { code: 0, stdout: PROGRAM_USAGE };
    if (argv.length === 2 && named !== null && argv[1] === '--help') return { code: 0, stdout: USAGE[named as CommandName] };
    const read = readArguments(argv);
    if ('problem' in read) return usageError(read.problem, json, read.command);
    const args = read.arguments;
    if (args.command !== 'docs' && args.command !== 'doctor') {
      const refused = environmentRefusal(context.runtime ?? runtimeNow(), () => gitNow(context.cwd));
      if (refused !== null) return { code: 2, stdout: renderErrors([refused], json, args.command) };
    }
    if (args.command !== 'check') return await HANDLERS[args.command](args, context, json);
    const parsed = checkOptions(args);
    if ('problem' in parsed) return usageError(parsed.problem, json, 'check');
    const outcome = await command(parsed.options, context);
    if ('errors' in outcome) return { code: 2, stdout: renderErrors(outcome.errors, json) };
    step('writing the report');
    const text = renderReport(outcome.report, json);
    return { code: outcome.report.findings.some((f) => f.severity === 'error') ? 1 : 0, stdout: text };
  } catch (error) {
    return { code: 2, stdout: renderErrors([internal(error)], json, named) };
  }
}

function isEntry(): boolean {
  try {
    return isMainThread && process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
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

if (isEntry()) start();
