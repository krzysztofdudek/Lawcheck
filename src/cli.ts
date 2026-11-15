#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { check } from './check.js';
import type { CheckContext, CheckOptions, CheckOutcome } from './check.js';
import { firstLine } from './law.js';
import { renderErrors, renderReport, safeJson, safeText } from './output.js';
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
  const result = await run(argv, context, command);
  return { ...result, stdout: argv.includes('--json') ? safeJson(result.stdout) : safeText(result.stdout) };
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
    if (args.command !== 'check') return await HANDLERS[args.command](args, context, json);
    const parsed = checkOptions(args);
    if ('problem' in parsed) return usageError(parsed.problem, json, 'check');
    const outcome = await command(parsed.options, context);
    if ('errors' in outcome) return { code: 2, stdout: renderErrors(outcome.errors, json) };
    const text = renderReport(outcome.report, json);
    return { code: outcome.report.findings.some((f) => f.severity === 'error') ? 1 : 0, stdout: text };
  } catch (error) {
    return { code: 2, stdout: renderErrors([internal(error)], json, named) };
  }
}

function finish(result: Result): void {
  process.stdout.write(result.stdout, () => process.exit(result.code));
}

function isEntry(): boolean {
  try {
    return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntry()) {
  absolutePath(process.env);
  if (process.platform === 'win32') process.env[NO_CURRENT_FOLDER] = '1';
  const json = process.argv.slice(2).includes('--json');
  const crash = (error: unknown) => {
    const text = renderErrors([internal(error)], json);
    process.stdout.write(json ? safeJson(text) : safeText(text), () => process.exit(2));
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => crash(new Error(`stopped by ${signal}`)));
  const warn = (line: string) => process.stderr.write(safeText(line) + '\n');
  main(process.argv.slice(2), { cwd: process.cwd(), env: process.env, warn }).then(finish, crash);
}
