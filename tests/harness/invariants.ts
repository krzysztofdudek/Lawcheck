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
  'harness-count': 'A test that starts the tool compares at least one of its outputs.',
};

export class Broken extends Error {
  readonly invariant: string;
  constructor(invariant: string, detail: string) {
    super(`${invariant}: ${detail}`);
    this.name = 'Broken';
    this.invariant = invariant;
  }
}

const FORBIDDEN = new RegExp('[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]', 'u');
const FORGED = /^(::|##\[|##vso\[)/;

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
    if (FORGED.test(line)) return `line ${i + 1} starts like a CI command: ${shown(line)}`;
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
  const exits = EXIT[schema]?.(document) ?? [];
  if (!exits.includes(code ?? -1)) return { problem: `${schema} with exit ${code}; the document means exit ${exits.join(' or ')}`, document };
  return { problem: null, document };
}
