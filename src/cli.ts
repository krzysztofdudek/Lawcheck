#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { check } from './check.js';
import type { CheckContext, CheckOptions, CheckOutcome } from './check.js';
import { firstLine } from './law.js';
import { renderErrors, renderReport, USAGE } from './output.js';
import type { ErrorItem } from './output.js';

export interface Result {
  code: number;
  stdout: string;
}

export type Command = (options: CheckOptions, context: CheckContext) => Promise<CheckOutcome>;

export function version(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

export function parseArguments(argv: string[]): { options: CheckOptions } | { problem: string } {
  if (argv.length === 0) return { problem: 'no command; the one command is check' };
  if (argv[0] !== 'check') return { problem: `unknown command '${argv[0]}'; the one command is check` };
  const seen = new Set<string>();
  let base: string | null = null;
  let maxCalls: number | null = null;
  for (let i = 1; i < argv.length; i++) {
    const word = argv[i]!;
    if (['--full', '--json', '--review', '--again'].includes(word)) {
      if (seen.has(word)) return { problem: `the flag ${word} is given twice` };
      seen.add(word);
    } else if (word === '--max-calls') {
      if (seen.has(word)) return { problem: 'the flag --max-calls is given twice' };
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) return { problem: 'the flag --max-calls takes a number' };
      if (!/^[0-9]+$/.test(value)) return { problem: `the flag --max-calls takes a number of digits, not '${value}'` };
      seen.add(word);
      maxCalls = Number(value);
      i++;
    } else if (word === '--base') {
      if (seen.has(word)) return { problem: 'the flag --base is given twice' };
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) return { problem: 'the flag --base takes a ref' };
      seen.add(word);
      base = value;
      i++;
    } else if (word.startsWith('-')) {
      return { problem: `unknown flag '${word}'` };
    } else {
      return { problem: `unexpected argument '${word}'; check takes no paths` };
    }
  }
  const review = seen.has('--review');
  if (!review && seen.has('--again')) return { problem: 'the flag --again works only with --review' };
  if (!review && seen.has('--max-calls')) return { problem: 'the flag --max-calls works only with --review' };
  return { options: { full: seen.has('--full'), base, review, again: seen.has('--again'), maxCalls } };
}

function internal(error: unknown): ErrorItem {
  return { code: 'internal', file: null, line: null, message: firstLine(error) || 'an unknown failure' };
}

export async function main(argv: string[], context: CheckContext, command: Command = check): Promise<Result> {
  const json = argv.includes('--json');
  try {
    if (argv.length === 1 && argv[0] === '--version') return { code: 0, stdout: version() + '\n' };
    if ((argv.length === 1 && argv[0] === '--help') || (argv.length === 2 && argv[0] === 'check' && argv[1] === '--help')) {
      return { code: 0, stdout: USAGE };
    }
    const parsed = parseArguments(argv);
    if ('problem' in parsed) {
      return { code: 2, stdout: renderErrors([{ code: 'usage', file: null, line: null, message: parsed.problem }], json) };
    }
    const outcome = await command(parsed.options, context);
    if ('errors' in outcome) return { code: 2, stdout: renderErrors(outcome.errors, json) };
    const text = renderReport(outcome.report, json);
    return { code: outcome.report.findings.some((f) => f.severity === 'error') ? 1 : 0, stdout: text };
  } catch (error) {
    return { code: 2, stdout: renderErrors([internal(error)], json) };
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
  const json = process.argv.slice(2).includes('--json');
  const crash = (error: unknown) => {
    process.stdout.write(renderErrors([internal(error)], json), () => process.exit(2));
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => crash(new Error(`stopped by ${signal}`)));
  const warn = (line: string) => process.stderr.write(line + '\n');
  main(process.argv.slice(2), { cwd: process.cwd(), env: process.env, warn }).then(finish, crash);
}
