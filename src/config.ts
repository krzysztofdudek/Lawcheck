import { statSync } from 'node:fs';
import { join } from 'node:path';
import { isAlias, isMap, isScalar, isSeq, LineCounter, Scalar } from 'yaml';
import type { Document, Node as YamlNode, Pair, YAMLMap } from 'yaml';
import { distance, nearestKey, parseUnique } from './law.js';
import { decode } from './types.js';
import { CONFIG_BYTES, readFailure, readWhole } from './limits.js';

export const CONFIG = '.lawcheck/config.yaml';
export const LOCAL_CONFIG = '.lawcheck/config.local.yaml';

export const PROVIDERS = ['anthropic', 'openai', 'google', 'openai-compatible', 'ollama', 'claude-code', 'codex', 'gemini-cli', 'copilot-cli'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const PROGRAM_PROVIDERS: Partial<Record<ProviderName, string>> = { 'claude-code': 'claude', codex: 'codex', 'gemini-cli': 'gemini', 'copilot-cli': 'copilot' };
// A model name goes to a program as one argument; 256 characters is far above any real name and far below what a command line can carry.
const MAX_MODEL = 256;
const TOP_KEYS = ['reviewer', 'runner'];
const REVIEWER_KEYS = ['provider', 'model', 'timeout', 'temperature', 'max_chars', 'parallel', 'max_calls'] as const;
export type ReviewerKey = (typeof REVIEWER_KEYS)[number];

export const REVIEWER_VARIABLES: Record<ReviewerKey, string> = {
  provider: 'LAWCHECK_REVIEWER_PROVIDER',
  model: 'LAWCHECK_REVIEWER_MODEL',
  timeout: 'LAWCHECK_REVIEWER_TIMEOUT',
  temperature: 'LAWCHECK_REVIEWER_TEMPERATURE',
  max_chars: 'LAWCHECK_REVIEWER_MAX_CHARS',
  parallel: 'LAWCHECK_REVIEWER_PARALLEL',
  max_calls: 'LAWCHECK_REVIEWER_MAX_CALLS',
};

// Where each value in force came from: a file, or the name of a variable. A key with no entry has its default.
export type Sources = Partial<Record<ReviewerKey, string>>;

export interface ReviewerConfig {
  provider: ProviderName | null;
  model: string | null;
  timeout: number;
  temperature: number | null;
  maxChars: number;
  parallel: number;
  maxCalls: number;
}

export const RUNNERS = ['global', 'npx', 'pnpm', 'yarn', 'bun'] as const;
export type Runner = (typeof RUNNERS)[number];

export const RUNNER_COMMANDS: Record<Runner, { words: string[]; install: string }> = {
  global: { words: ['lawcheck'], install: 'npm i -g lawcheck' },
  npx: { words: ['npx', '--no-install', 'lawcheck'], install: 'npm install' },
  pnpm: { words: ['pnpm', 'exec', 'lawcheck'], install: 'pnpm install' },
  yarn: { words: ['yarn', 'run', 'lawcheck'], install: 'yarn install' },
  bun: { words: ['bun', 'x', '--no-install', 'lawcheck'], install: 'bun install' },
};

export function runnerLine(text: string): { value: string; line: number } | null {
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, '');
    if (!line.startsWith('runner:')) continue;
    const rest = line.slice('runner:'.length);
    const comment = rest.search(/[ \t]#/);
    return { value: (comment < 0 ? rest : rest.slice(0, comment)).replace(/^[ \t]+|[ \t]+$/g, ''), line: i + 1 };
  }
  return null;
}

export function runnerOf(text: string): string {
  return runnerLine(text)?.value ?? 'global';
}

export function unknownRunner(value: string): string {
  const scored = RUNNERS.map((name) => ({ name, d: distance(value, name) })).filter(({ d }) => d <= 2);
  const best = Math.min(...scored.map(({ d }) => d));
  const near = scored.filter(({ d }) => d === best).map(({ name }) => `'${name}'`);
  const part = near.length === 0 ? '' : ` (did you mean ${near.slice(0, 2).join(' or ')}?)`;
  return `the runner '${value}' is unknown${part}; it takes ${RUNNERS.join(', ').replace(/, (?=[^,]*$)/, ' or ')}`;
}

export const RUNNER_ONE_LINE = 'write runner on one line of its own at the top level, as runner: pnpm';

export interface ConfigProblem {
  line: number;
  message: string;
}

// A problem of the settings of one machine: file is null for a variable, which has no line either.
export interface SettingProblem {
  file: string | null;
  line: number | null;
  message: string;
}

export type Settings = { config: ReviewerConfig; from: Sources } | { problems: SettingProblem[] };

interface Entry {
  value: YamlNode | null;
  // reviewer.<key> in a file, the variable's name in the environment.
  name: string;
  file: string | null;
  line: number | null;
  // The line of the reviewer section that holds the entry.
  section: number | null;
}

type Entries = Map<ReviewerKey, Entry>;

export const DEFAULT_CONFIG: ReviewerConfig = {
  provider: null,
  model: null,
  timeout: 60,
  temperature: 0,
  maxChars: 50000,
  parallel: 4,
  maxCalls: 100,
};

const KEY_PLACES = "set LAWCHECK_REVIEWER_KEY, or the provider's own ANTHROPIC_API_KEY, OPENAI_API_KEY or GOOGLE_API_KEY, in the environment";
const NO_KEYS = `a key never goes into a committed file; ${KEY_PLACES}`;
const NO_KEYS_LOCAL = `a key never goes into ${LOCAL_CONFIG}; ${KEY_PLACES}`;

export class ConfigTooLarge extends Error {
  constructor(
    readonly bytes: number,
    readonly file: string = CONFIG,
  ) {
    super(`${file} holds ${bytes} bytes`);
  }
}

function readText(root: string, file: string): { text: string | null } | { problems: SettingProblem[] } {
  const path = join(root, file);
  try {
    if (!statSync(path).isFile()) return { problems: [{ file, line: 1, message: `${file} is no file` }] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { text: null };
    return { problems: [{ file, line: 1, message: `${file} cannot be read (${code ?? 'an error'})` }] };
  }
  let bytes: Uint8Array;
  try {
    bytes = readWhole(path, file);
  } catch (error) {
    return { problems: [{ file, line: 1, message: `${file} cannot be read (${readFailure(error)})` }] };
  }
  if (bytes.length > CONFIG_BYTES) throw new ConfigTooLarge(bytes.length, file);
  return { text: decode(bytes) };
}

function inFile(problems: SettingProblem[]): ConfigProblem[] {
  return problems.map(({ line, message }) => ({ line: line ?? 1, message }));
}

export function readConfig(root: string): { config: ReviewerConfig } | { problems: ConfigProblem[] } {
  const read = readText(root, CONFIG);
  if ('problems' in read) return { problems: inFile(read.problems) };
  return read.text === null ? { config: { ...DEFAULT_CONFIG } } : parseConfig(read.text);
}

export function parseConfig(text: string): { config: ReviewerConfig } | { problems: ConfigProblem[] } {
  const settled = settle([text], [CONFIG], {});
  return 'problems' in settled ? { problems: inFile(settled.problems) } : { config: settled.config };
}

// The settings in force on this machine: the variables over config.local.yaml over config.yaml, key by key. committed stands in for the config.yaml on disk, as the text of another commit does.
export function readSettings(root: string, env: Record<string, string | undefined>, committed?: string | null): Settings {
  const texts: (string | null)[] = [];
  for (const file of [CONFIG, LOCAL_CONFIG]) {
    if (file === CONFIG && committed !== undefined) {
      texts.push(committed);
      continue;
    }
    const read = readText(root, file);
    if ('problems' in read) return read;
    texts.push(read.text);
  }
  return settle(texts, [CONFIG, LOCAL_CONFIG], env);
}

function settle(texts: (string | null)[], files: string[], env: Record<string, string | undefined>): Settings {
  const problems: SettingProblem[] = [];
  const layers: Entries[] = [];
  texts.forEach((text, at) => {
    if (text === null) return;
    const file = files[at]!;
    const counter = new LineCounter();
    const { doc, errors } = parseUnique(text, counter);
    if (errors.length > 0) {
      for (const error of errors) problems.push({ file, line: counter.linePos(error.pos).line, message: `the config does not parse: ${error.message.split('\n')[0]}` });
      return;
    }
    const reader = new ConfigReader(doc, counter, text, file);
    layers.push(reader.read());
    problems.push(...reader.problems);
  });
  if (layers.length < texts.filter((text) => text !== null).length) return { problems };
  const fromEnv: Entries = new Map();
  for (const key of REVIEWER_KEYS) {
    const name = REVIEWER_VARIABLES[key];
    const value = env[name];
    if (value === undefined || value === '') continue;
    const number = key !== 'provider' && key !== 'model' && /^-?(\d+\.?\d*|\.\d+)$/.test(value);
    fromEnv.set(key, { value: new Scalar(number ? Number(value) : value), name, file: null, line: null, section: null });
  }
  layers.push(fromEnv);
  const inForce: Entries = new Map();
  for (const layer of layers) {
    // A model and a temperature belong to the provider they were written for, so a place that names the provider does not take them from a place below it.
    if (layer.has('provider')) {
      inForce.delete('model');
      inForce.delete('temperature');
    }
    for (const [key, entry] of layer) inForce.set(key, entry);
  }
  return derive(inForce, problems);
}

function derive(seen: Entries, problems: SettingProblem[]): Settings {
  const config: ReviewerConfig = { ...DEFAULT_CONFIG };
  const problem = (entry: Entry, message: string, line: number | null = entry.line): void => void problems.push({ file: entry.file, line, message });

  const provider = seen.get('provider');
  if (provider !== undefined) {
    const name = stringOf(provider.value);
    if (name === null) problem(provider, `${provider.name} takes a string, not ${describe(provider.value)}`);
    else if ((PROVIDERS as readonly string[]).includes(name)) config.provider = name as ProviderName;
    else {
      const near = nearestKey(name, [...PROVIDERS]);
      problem(provider, `the provider '${name}' is unknown${near === null ? '' : ` (did you mean '${near}'?)`}; this version has ${PROVIDERS.join(', ')}`);
    }
  }

  const model = seen.get('model');
  if (model !== undefined) {
    const text = stringOf(model.value);
    if (text === null || text.trim() === '' || text.length > MAX_MODEL || /[\u0000-\u001f\u007f]/.test(text)) {
      const what = text !== null && text.length > MAX_MODEL ? `a string of ${text.length} characters` : describe(model.value);
      problem(model, `${model.name} takes a non-empty string of at most ${MAX_MODEL} characters with no control character, not ${what}`);
    } else {
      config.model = text;
    }
  } else if (config.provider !== null && PROGRAM_PROVIDERS[config.provider] === undefined) {
    const where = provider!.file === null ? `a model in ${REVIEWER_VARIABLES.model}, since ${provider!.name} names the provider` : 'reviewer.model';
    problem(provider!, `the provider '${config.provider}' needs ${where}`, provider!.section);
  }

  const program = config.provider === null ? undefined : PROGRAM_PROVIDERS[config.provider];
  if (program !== undefined) {
    config.timeout = 300;
    config.parallel = 1;
    config.temperature = null;
  } else if (config.provider === 'ollama') {
    config.timeout = 300;
  }
  const integer = (key: ReviewerKey, min: number, max: number, what: string, set: (value: number) => void): void => {
    const entry = seen.get(key);
    if (entry === undefined) return;
    const value = numberOf(entry.value);
    if (value === null || !Number.isInteger(value) || value < min || value > max) problem(entry, `${entry.name} takes ${what}, not ${describe(entry.value)}`);
    else set(value);
  };
  integer('timeout', 1, 86400, 'an integer of seconds from 1 to 86400', (n) => (config.timeout = n));
  integer('max_chars', 1, Infinity, 'an integer of at least 1', (n) => (config.maxChars = n));
  integer('parallel', 1, Infinity, 'an integer of at least 1', (n) => (config.parallel = n));
  integer('max_calls', 0, Infinity, 'an integer of at least 0', (n) => (config.maxCalls = n));

  const temperature = seen.get('temperature');
  if (temperature !== undefined) {
    if (program !== undefined) {
      problem(temperature, `the provider ${config.provider} takes no temperature: the ${program} program runs at its own`);
    } else {
      const value = numberOf(temperature.value);
      if (value === null || value < 0) problem(temperature, `${temperature.name} takes a number of at least 0, not ${describe(temperature.value)}`);
      else config.temperature = value;
    }
  }
  if (problems.length > 0) return { problems };
  const from: Sources = {};
  for (const [key, entry] of seen) from[key] = entry.file ?? entry.name;
  return { config, from };
}

function numberOf(value: YamlNode | null): number | null {
  return isScalar(value) && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null;
}

function stringOf(value: YamlNode | null): string | null {
  return isScalar(value) && typeof value.value === 'string' ? value.value : null;
}

class ConfigReader {
  readonly problems: SettingProblem[] = [];

  constructor(
    private readonly doc: Document,
    private readonly counter: LineCounter,
    private readonly text: string,
    private readonly file: string,
  ) {}

  read(): Entries {
    const entries: Entries = new Map();
    const local = this.file === LOCAL_CONFIG;
    const top = this.resolve(this.doc.contents);
    if (top === null || (isScalar(top) && top.value === null)) return entries;
    if (!isMap(top)) {
      this.problem(this.lineOf(top), `the config takes a mapping, not ${describe(top)}`);
      return entries;
    }
    for (const pair of top.items) {
      const key = this.keyOf(pair);
      if (key === null) continue;
      const line = this.lineOf(pair.key);
      if (key === 'reviewer') {
        const value = this.resolve(pair.value);
        if (!isMap(value)) this.problem(line, `'reviewer' takes a mapping, not ${describe(value)}`);
        else this.readReviewer(value, line, entries);
      } else if (key === 'runner' && local) {
        this.problem(line, `runner is not read from ${LOCAL_CONFIG}: the plugin takes it from ${CONFIG} alone`);
      } else if (key === 'runner') {
        this.readRunner(this.resolve(pair.value), line);
      } else if (key === 'keys') {
        this.problem(line, local ? NO_KEYS_LOCAL : NO_KEYS);
      } else {
        this.unknown(key, local ? ['reviewer'] : TOP_KEYS, line, 'at the top of the config');
      }
    }
    return entries;
  }

  private readRunner(value: YamlNode | null, line: number): void {
    const name = isScalar(value) && value.value !== null ? String(value.value) : '';
    if (!(RUNNERS as readonly string[]).includes(name)) this.problem(line, unknownRunner(isScalar(value) ? (value.source ?? name) : name));
    else if (runnerOf(this.text) !== name) this.problem(line, RUNNER_ONE_LINE);
  }

  private readReviewer(map: YAMLMap, section: number, entries: Entries): void {
    for (const pair of map.items) {
      const key = this.keyOf(pair);
      if (key === null) continue;
      const line = this.lineOf(pair.key);
      if (key === 'keys') this.problem(line, this.file === LOCAL_CONFIG ? NO_KEYS_LOCAL : NO_KEYS);
      else if (key === 'endpoint') this.problem(line, 'reviewer.endpoint is not read: the address comes from the variable LAWCHECK_REVIEWER_ENDPOINT');
      else if (!(REVIEWER_KEYS as readonly string[]).includes(key)) this.unknown(key, [...REVIEWER_KEYS], line, "in 'reviewer'");
      else entries.set(key as ReviewerKey, { value: this.resolve(pair.value), name: `reviewer.${key}`, file: this.file, line, section });
    }
  }

  private resolve(node: unknown): YamlNode | null {
    let current = node;
    for (let depth = 0; isAlias(current) && depth < 100; depth++) current = current.resolve(this.doc) ?? null;
    return (current ?? null) as YamlNode | null;
  }

  private keyOf(pair: Pair): string | null {
    const key = this.resolve(pair.key);
    if (isScalar(key) && typeof key.value === 'string') return key.value;
    const text = isScalar(key) ? (key.source ?? String(key.value)) : String(key);
    this.problem(this.lineOf(pair.key), `the key '${text}' is no string; write it in quotes`);
    return null;
  }

  private lineOf(node: unknown): number {
    const range = (node as { range?: [number, number, number] } | null)?.range;
    return range ? this.counter.linePos(range[0]).line : 1;
  }

  private problem(line: number, message: string): void {
    this.problems.push({ file: this.file, line, message });
  }

  private unknown(key: string, known: string[], line: number, where: string): void {
    const near = nearestKey(key, known);
    this.problem(line, `unknown key '${key}' ${where}${near === null ? '' : ` (did you mean '${near}'?)`}`);
  }
}

function describe(value: YamlNode | null): string {
  if (value === null) return 'nothing';
  if (isMap(value)) return 'a mapping';
  if (isSeq(value)) return 'a sequence';
  if (isScalar(value)) {
    const v = value.value;
    if (v === null) return 'nothing';
    if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'boolean') return String(v);
  }
  return 'another kind of value';
}
