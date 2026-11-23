import { step } from './progress.js';
import { check } from './check.js';
import type { CheckContext, CheckOptions, CheckOutcome } from './check.js';
import { firstLine } from './law.js';
import { blocking, renderErrors, renderReport, safeJson, safeText } from './output.js';
import { hiddenJson, useKeys } from './keys.js';
import { COMMANDS, number, PROGRAM_USAGE, readArguments, text, usageError, USAGE, version } from './args.js';
import type { Arguments, CommandName, Result } from './args.js';

export { version };
export type { Result };
import { init } from './init.js';
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
  if (args.words.length > 0 && ['--full', '--strict', '--base', '--review', '--again', '--max-calls'].some((flag) => args.flags.has(flag))) {
    return { problem: 'paths go with --json alone' };
  }
  if (!review && args.flags.has('--again')) return { problem: 'the flag --again works only with --review' };
  if (!review && args.flags.has('--max-calls')) return { problem: 'the flag --max-calls works only with --review' };
  return { options: { full: args.flags.has('--full') || args.flags.has('--strict'), strict: args.flags.has('--strict'), base: text(args, '--base'), review, again: args.flags.has('--again'), maxCalls: number(args, '--max-calls'), paths: args.words } };
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
    if ('errors' in outcome) return { code: 2, stdout: renderErrors(outcome.errors, json, 'check', Infinity, outcome.calls) };
    step('writing the report');
    const text = renderReport(outcome.report, json);
    return { code: blocking(outcome.report).length > 0 ? 1 : 0, stdout: text };
  } catch (error) {
    return { code: 2, stdout: renderErrors([internal(error)], json, named) };
  }
}
