import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

export const INVARIANTS: Record<string, string> = {
  'harness-1': 'The exit code is 0, 1 or 2. A death by signal fails the test.',
  'harness-2': 'Text output holds no forbidden character and no forged line (invariant I-out-1).',
  'harness-3': 'With --json, standard output is one document that validates against the schema of its schema field, and its exit code agrees with it.',
  'harness-4': 'Standard error is empty unless the test says what it expects there.',
  'harness-5': 'The code internal fails the test unless the test names it; docs/codes.md calls internal a fault of Lawcheck.',
  'harness-6': 'The run ends inside the test\'s time budget, and afterwards no process of the run is alive.',
  'harness-7': 'git status, HEAD and the index are the same before and after, unless the command writes by contract (init, check --review), and then only the files the contract names change.',
  'harness-8': 'The test\'s temporary folder is the only place that changed.',
  'harness-count': 'A test makes at least one assertion, and a test that starts the tool compares at least one of its outputs.',
};

// What the harness does not close, in one place.
export const KNOWN_LIMITS: string[] = [
  "A rule's runner starts with an empty environment, so a detached child of a rule, or any child started with env: {}, carries no mark; it is found only while it lives below the tool at a sample, by its process group, or on Linux by a working folder inside the run's folders.",
  'Reading stdout, stderr, code, signal or json of a run counts as comparing it, whether or not the test asserts on what it read; the assertion that the test makes at all is counted apart. A test counts as asserting when it calls a function of node:assert or expectBroken; a bare call of assert(value) is not counted, and a test that returns before its first assertion on a platform it names in PLATFORM_SKIPS is not asked for one.',
  'A test that passes a fifth of TEST_BUDGET_MS with no entry in SLOW_TESTS is only listed by the reporter, never failed: a failure there would turn timing noise into false reds, and the full budget already fails a test that is slow.',
  'Node on Windows cannot read the environment of another process, and a list of processes with their parents comes only from PowerShell, which takes seconds a call on a busy machine, so there the harness does not look for a process left alive; PLATFORM_SKIPS names it.',
  'On Windows LOCALAPPDATA stays the machine\'s, since Windows programs keep their caches there (the guard\'s PowerShell among them); a write under it is not seen. In the home, Windows makes the folders of a profile for a program that asks for one, so there an empty folder does not count, only a file.',
  'The harness walks no node_modules folder, in the repository or beside it, since a node_modules there is a link to the checkout\'s; a write inside one is not seen.',
];

export class Broken extends Error {
  readonly invariant: string;
  constructor(invariant: string, detail: string) {
    super(`${invariant}: ${detail}`);
    this.name = 'Broken';
    this.invariant = invariant;
  }
}

// spec/check-slice.md, section 6, invariant I-out-1: the control characters but the line feed, the two separators, and every format character (category Cf) but the joiners U+200C and U+200D.
const FORBIDDEN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]|(?![\u200c\u200d])\p{Cf}/u;
// What a JSON document may hold only as a \u escape: the same set less the control characters, which JSON.stringify already escapes.
const RAW_IN_JSON = /[\u007f-\u009f\u2028\u2029]|(?![\u200c\u200d])\p{Cf}/gu;
// GitHub reads a command after leading white space, and Azure reads ##vso[ anywhere in a line.
const FORGED = /^\s*(::|##\[)|##vso\[/u;

const shown = (text: string) => JSON.stringify(text.length > 120 ? text.slice(0, 120) + '...' : text);

export function outputProblem(text: string): string | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const bad = FORBIDDEN.exec(line);
    if (bad !== null) {
      const code = bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
      return `line ${i + 1} holds U+${code}: ${shown(line)}`;
    }
    if (FORGED.test(line)) return `line ${i + 1} reads as a CI command: ${shown(line)}`;
  }
  return null;
}

export function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) stringsOf(item, out);
  return out;
}

const INTERNAL = /(^|  )error\[internal\]  /m;

export function hasInternal(stdout: string, document: unknown): boolean {
  if (document !== undefined && document !== null && typeof document === 'object') {
    const d = document as { errors?: { code?: unknown }[]; findings?: { code?: unknown }[] };
    return [...(d.errors ?? []), ...(d.findings ?? [])].some((item) => item?.code === 'internal');
  }
  return INTERNAL.test(stdout);
}

type Validator = ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };

const SCHEMAS_DIR = join(import.meta.dirname, 'schemas');
let validators: Map<string, Validator> | null = null;

export function schemaNames(): string[] {
  return readdirSync(SCHEMAS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length).replace(/-(\d+)$/, '/$1'))
    .sort();
}

function validatorOf(schema: string): Validator | null {
  if (validators === null) {
    const require = createRequire(import.meta.url);
    const Ajv = require('ajv') as new (options: object) => { compile(schema: object): Validator };
    const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, allowUnionTypes: true });
    validators = new Map();
    for (const name of schemaNames()) {
      const file = join(SCHEMAS_DIR, name.replace('/', '-') + '.json');
      validators.set(name, ajv.compile(JSON.parse(readFileSync(file, 'utf8'))));
    }
  }
  return validators.get(schema) ?? null;
}

const EXIT: Record<string, (document: any) => number[]> = {
  'lawcheck-check/0': (d) => [d.result === 'pass' ? 0 : 1],
  'lawcheck-error/1': () => [2],
  'lawcheck-try/0': (d) => [d.summary.findings > 0 ? 1 : 0],
  'lawcheck-doctor/0': (d) => [d.result === 'pass' ? 0 : 2],
  'lawcheck-init/0': () => [0],
  'lawcheck-prime/0': () => [0],
  'lawcheck-explain/0': () => [0],
  'lawcheck-docs/0': () => [0],
};

const count = (items: any[], keep: (item: any) => boolean) => items.filter(keep).length;

function differ(pairs: [string, number, number][]): string | null {
  const wrong = pairs.filter(([, said, counted]) => said !== counted).map(([name, said, counted]) => `${name} is ${said}, the lists hold ${counted}`);
  return wrong.length === 0 ? null : wrong.join('; ');
}

// spec/check-slice.md, section 6, and docs/json.md say what each count counts.
const COUNTS: Record<string, (document: any) => string | null> = {
  'lawcheck-check/0': (d) =>
    differ([
      ['summary.errors', d.summary.errors, count(d.findings, (f) => !f.debt && f.severity === 'error')],
      ['summary.warnings', d.summary.warnings, count(d.findings, (f) => !f.debt && f.severity === 'warning')],
      ['summary.debt', d.summary.debt, count(d.findings, (f) => f.debt)],
      ['summary.waivers', d.summary.waivers, count(d.waivers, (w) => !w.debt)],
      ['summary.unresolved', d.summary.unresolved, count(d.unresolved, (u) => !u.debt)],
    ]),
  'lawcheck-try/0': (d) =>
    differ([
      ['summary.findings', d.summary.findings, d.runs.reduce((n: number, r: any) => n + r.findings.length, 0)],
      ['summary.files_with_findings', d.summary.files_with_findings, new Set(d.runs.filter((r: any) => r.findings.length > 0).map((r: any) => r.file)).size],
      ['summary.waived', d.summary.waived, d.runs.reduce((n: number, r: any) => n + r.waived, 0)],
      ['files', d.files, new Set(d.runs.map((r: any) => r.file)).size],
    ]),
  'lawcheck-explain/0': (d) => (d.subject === 'directory' ? differ([['files', d.files, d.types.reduce((n: number, t: any) => n + t.files, 0)]]) : null),
};

export function jsonProblem(stdout: string, code: number | null): { problem: string | null; document: unknown } {
  if (!stdout.endsWith('\n')) return { problem: 'standard output does not end with a line end', document: undefined };
  let document: unknown;
  try {
    document = JSON.parse(stdout);
  } catch (error) {
    return { problem: `standard output is not one JSON document: ${(error as Error).message}`, document: undefined };
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return { problem: 'the document is not an object', document };
  const keys = Object.keys(document);
  if (keys[0] !== 'schema') return { problem: `the first key is ${JSON.stringify(keys[0])}, not schema`, document };
  const schema = (document as { schema: unknown }).schema;
  if (typeof schema !== 'string') return { problem: 'schema is not a string', document };
  const validate = validatorOf(schema);
  if (validate === null) return { problem: `no schema file for ${schema} in tests/harness/schemas`, document };
  if (!validate(document)) {
    const errors = (validate.errors ?? []).slice(0, 5).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
    return { problem: `the document breaks ${schema}: ${errors.join('; ')}`, document };
  }
  const counts = COUNTS[schema]?.(document);
  if (counts) return { problem: `${schema}: ${counts}`, document };
  const exits = EXIT[schema]?.(document) ?? [];
  if (!exits.includes(code ?? -1)) return { problem: `${schema} with exit ${code}; the document means exit ${exits.join(' or ')}`, document };
  const units = (c: string) => [...Array(c.length).keys()].map((i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`).join('');
  if (stdout !== JSON.stringify(document, null, 2).replace(RAW_IN_JSON, units) + '\n') {
    return { problem: 'standard output is not exactly JSON.stringify(document, null, 2) with the characters of I-out-1 as \\u escapes, and a line end, as docs/json.md and spec/check-slice.md, section 6, say', document };
  }
  return { problem: null, document };
}
