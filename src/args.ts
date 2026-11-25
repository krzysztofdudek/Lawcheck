import { readFileSync } from 'node:fs';
import { renderErrors } from './output.js';
import type { ErrorItem } from './output.js';
import type { Runtime } from './environment.js';

export interface Result {
  code: number;
  stdout: string;
}

export function version(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

export function usageError(problem: string, json: boolean, command: string | null): Result {
  return errorResult([{ code: 'usage', file: null, line: null, message: problem }], json, command);
}

export function errorResult(errors: ErrorItem[], json: boolean, command: string | null, calls = 0): Result {
  return { code: 2, stdout: renderErrors(errors, json, command, Infinity, calls) };
}

export function documentOf(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

export const COMMANDS = ['init', 'prime', 'check', 'explain', 'try', 'docs', 'doctor'] as const;
export type CommandName = (typeof COMMANDS)[number];

type Value = 'ref' | 'digits' | 'id' | 'path';
type Flags = Record<string, 'switch' | Value>;

const FLAGS: Record<CommandName, Flags> = {
  init: { '--json': 'switch' },
  prime: { '--json': 'switch' },
  check: { '--full': 'switch', '--strict': 'switch', '--base': 'ref', '--law-from': 'ref', '--review': 'switch', '--again': 'switch', '--max-calls': 'digits', '--sarif': 'path', '--json': 'switch' },
  explain: { '--type': 'id', '--rule': 'id', '--tree': 'switch', '--json': 'switch' },
  try: { '--times': 'digits', '--dry-run': 'switch', '--max-calls': 'digits', '--json': 'switch' },
  docs: { '--json': 'switch' },
  doctor: { '--base': 'ref', '--reviewer': 'switch', '--json': 'switch' },
};

export const PROGRAM_USAGE = [
  'usage: lawcheck <command> [<arguments>] [--json]',
  '  init  starts a law in the current directory',
  '  prime  prints what a coding agent reads at the start of a session',
  '  check  checks the files of this change, or the files named, against the law',
  '  explain  says why a file, a type or a rule has the law it has',
  '  try  runs one rule on chosen files and records nothing',
  '  docs  prints the reference, one topic at a time',
  '  doctor  says what is wrong with this setup',
  '',
].join('\n');

export const USAGE: Record<CommandName, string> = {
  init: [
    'usage: lawcheck init [--json]',
    '',
    'Starts a law in the current directory: writes .lawcheck/law.yaml and .lawcheck/.gitignore when they are absent.',
    '',
    '  --json  print one JSON document',
    '',
  ].join('\n'),
  prime: [
    'usage: lawcheck prime [--json]',
    '',
    "Prints how to work with Lawcheck here, then this repository's law in short.",
    '',
    '  --json  print one JSON document',
    '',
  ].join('\n'),
  check: [
    'usage: lawcheck check [--full] [--strict] [--base <ref>] [--law-from <ref>] [--review [--again] [--max-calls <n>]] [--sarif <file>] [--json]',
    '       lawcheck check <path or pattern>... [--json]',
    '',
    'Checks the files of this change, or the files named, against .lawcheck/law.yaml.',
    '',
    '  <path or pattern>  judge these files, changed or not, and no others',
    '  --full             also judge the files outside the change, as debt',
    '  --strict           as --full, and debt fails the run as it would in the change',
    '  --base <ref>       the base of the change; else LAWCHECK_BASE, else a CI variable, else origin/HEAD',
    '  --law-from <ref>   judge by the law of this commit, read from git; no default',
    '  --review           ask the reviewer for the reviews that have no verdict',
    '  --again            with --review, ask again where a failure is cached',
    '  --max-calls <n>    with --review, the most requests this run sends',
    '  --sarif <file>     also write the findings to this file as SARIF 2.1.0',
    '  --json             print one JSON document',
    '',
    'Exit 0: no error. Exit 1: the code breaks the law. Exit 2: no conclusion.',
    '',
  ].join('\n'),
  explain: [
    'usage: lawcheck explain (<path> [--tree] | --type <id> | --rule <id>) [--json]',
    '',
    'Says why a file has the law it has, or explains a type or a rule. Runs no rule and writes nothing.',
    '',
    '  <path>       a file, a file that does not exist yet, or a directory',
    '  --tree       with a file, print its syntax tree as a script rule gets it',
    '  --type <id>  a type of the law, with its files',
    '  --rule <id>  a rule of the law, with the files it binds',
    '  --json       print one JSON document',
    '',
  ].join('\n'),
  try: [
    'usage: lawcheck try <rule> [<path or pattern>...] [--times <n>] [--dry-run] [--max-calls <n>] [--json]',
    '',
    'Runs one rule on chosen files, without a base, and writes nothing in the repository.',
    '',
    '  <path or pattern>  a file, a directory or a pattern; a script rule without one takes the files it binds',
    '  --times <n>        with a reviewer rule, ask about each file n times',
    '  --dry-run          with a reviewer rule, print the calls and make none',
    '  --max-calls <n>    with a reviewer rule, the most requests this run sends',
    '  --json             print one JSON document',
    '',
    'Exit 0: no finding. Exit 1: a finding. Exit 2: the run could not be made.',
    '',
  ].join('\n'),
  docs: [
    'usage: lawcheck docs [<topic>] [--json]',
    '',
    "Prints the tool's reference. Without a topic, lists the topics.",
    '',
    '  --json  print one JSON document',
    '',
  ].join('\n'),
  doctor: [
    'usage: lawcheck doctor [--base <ref>] [--reviewer] [--json]',
    '',
    'Says what is wrong with this setup, with one next step for each problem. Writes nothing.',
    '',
    '  --base <ref>  the base of the change; else LAWCHECK_BASE, else origin/HEAD',
    '  --reviewer    send the reviewer one small test request',
    '  --json        print one JSON document',
    '',
  ].join('\n'),
};

export interface Arguments {
  command: CommandName;
  flags: Map<string, string | true>;
  words: string[];
}

export type Read = { arguments: Arguments } | { problem: string; command: CommandName | null };

const LIST = COMMANDS.join(', ');

function what(kind: Value): string {
  return kind === 'ref' ? 'a ref' : kind === 'digits' ? 'a number' : kind === 'path' ? 'a path' : 'an id';
}

export function readArguments(argv: string[]): Read {
  if (argv.length === 0) return { problem: `no command; the commands are ${LIST}`, command: null };
  const name = argv[0]!;
  if (!(COMMANDS as readonly string[]).includes(name)) return { problem: `unknown command '${name}'; the commands are ${LIST}`, command: null };
  const command = name as CommandName;
  const known = FLAGS[command];
  const flags = new Map<string, string | true>();
  const words: string[] = [];
  const fail = (problem: string): Read => ({ problem, command });
  for (let i = 1; i < argv.length; i++) {
    const word = argv[i]!;
    if (!word.startsWith('-')) {
      words.push(word);
      continue;
    }
    const kind = known[word];
    if (kind === undefined) return fail(`unknown flag '${word}'`);
    if (flags.has(word)) return fail(`the flag ${word} is given twice`);
    if (kind === 'switch') {
      flags.set(word, true);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('-')) return fail(`the flag ${word} takes ${what(kind)}`);
    if (kind === 'digits' && !/^[0-9]+$/.test(value)) return fail(`the flag ${word} takes a number of digits, not '${value}'`);
    if (kind === 'digits' && !Number.isSafeInteger(Number(value))) return fail(`the flag ${word} takes a number up to ${Number.MAX_SAFE_INTEGER}, not '${value}'`);
    flags.set(word, value);
    i++;
  }
  return { arguments: { command, flags, words } };
}

export function number(args: Arguments, flag: string): number | null {
  const value = args.flags.get(flag);
  return typeof value === 'string' ? Number(value) : null;
}

export function text(args: Arguments, flag: string): string | null {
  const value = args.flags.get(flag);
  return typeof value === 'string' ? value : null;
}

export function noWords(args: Arguments): string | null {
  const word = args.words[0];
  return word === undefined ? null : `unexpected argument '${word}'; ${args.command} takes no arguments`;
}

export interface CheckContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  warn?: (line: string) => void;
  runtime?: Runtime;
}
