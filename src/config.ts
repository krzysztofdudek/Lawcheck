import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import type { Document, Node as YamlNode, Pair, YAMLMap } from 'yaml';
import { nearestKey } from './law.js';
import { decode } from './types.js';

export const CONFIG = '.lawcheck/config.yaml';

export const PROVIDERS = ['openai-compatible', 'anthropic', 'claude-code'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

const LATER_PROVIDERS = ['openai', 'google', 'ollama', 'codex', 'gemini-cli', 'copilot-cli'];
const TOP_KEYS = ['reviewer'];
const REVIEWER_KEYS = ['provider', 'model', 'timeout', 'temperature', 'max_chars', 'parallel', 'max_calls'];

export interface ReviewerConfig {
  provider: ProviderName | null;
  model: string | null;
  timeout: number;
  temperature: number | null;
  maxChars: number;
  parallel: number;
  maxCalls: number;
}

export interface ConfigProblem {
  line: number;
  message: string;
}

export const DEFAULT_CONFIG: ReviewerConfig = {
  provider: null,
  model: null,
  timeout: 60,
  temperature: 0,
  maxChars: 50000,
  parallel: 4,
  maxCalls: 100,
};

const NO_KEYS = 'a key never goes into a committed file; set LAWCHECK_REVIEWER_KEY, or ANTHROPIC_API_KEY for anthropic, in the environment';

export function readConfig(root: string): { config: ReviewerConfig } | { problems: ConfigProblem[] } {
  const path = join(root, CONFIG);
  try {
    if (!statSync(path).isFile()) return { problems: [{ line: 1, message: `${CONFIG} is no file` }] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { config: { ...DEFAULT_CONFIG } };
    return { problems: [{ line: 1, message: `${CONFIG} cannot be read (${code ?? 'an error'})` }] };
  }
  let text: string;
  try {
    text = decode(readFileSync(path));
  } catch (error) {
    return { problems: [{ line: 1, message: `${CONFIG} cannot be read (${(error as NodeJS.ErrnoException).code ?? 'an error'})` }] };
  }
  return parseConfig(text);
}

export function parseConfig(text: string): { config: ReviewerConfig } | { problems: ConfigProblem[] } {
  const counter = new LineCounter();
  const doc = parseDocument(text, { lineCounter: counter, prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    return {
      problems: doc.errors.map((error) => ({
        line: counter.linePos(error.pos[0]).line,
        message: `the config does not parse: ${error.message.split('\n')[0]}`,
      })),
    };
  }
  return new ConfigReader(doc, counter).read();
}

class ConfigReader {
  private readonly problems: ConfigProblem[] = [];

  constructor(
    private readonly doc: Document,
    private readonly counter: LineCounter,
  ) {}

  read(): { config: ReviewerConfig } | { problems: ConfigProblem[] } {
    const config: ReviewerConfig = { ...DEFAULT_CONFIG };
    const top = this.resolve(this.doc.contents);
    if (top === null || (isScalar(top) && top.value === null)) return { config };
    if (!isMap(top)) {
      this.problem(this.lineOf(top), `the config takes a mapping, not ${describe(top)}`);
      return { problems: this.problems };
    }
    for (const pair of top.items) {
      const key = this.keyOf(pair);
      if (key === null) continue;
      const line = this.lineOf(pair.key);
      if (key === 'reviewer') {
        const value = this.resolve(pair.value);
        if (!isMap(value)) this.problem(line, `'reviewer' takes a mapping, not ${describe(value)}`);
        else this.readReviewer(value, line, config);
      } else if (key === 'keys') {
        this.problem(line, NO_KEYS);
      } else {
        this.unknown(key, TOP_KEYS, line, 'at the top of the config');
      }
    }
    return this.problems.length > 0 ? { problems: this.problems } : { config };
  }

  private readReviewer(map: YAMLMap, reviewerLine: number, config: ReviewerConfig): void {
    const seen = new Map<string, { value: YamlNode | null; line: number }>();
    for (const pair of map.items) {
      const key = this.keyOf(pair);
      if (key === null) continue;
      const line = this.lineOf(pair.key);
      if (key === 'keys') this.problem(line, NO_KEYS);
      else if (key === 'endpoint') this.problem(line, 'reviewer.endpoint is not read: the address comes from the variable LAWCHECK_REVIEWER_ENDPOINT');
      else if (!REVIEWER_KEYS.includes(key)) this.unknown(key, REVIEWER_KEYS, line, "in 'reviewer'");
      else seen.set(key, { value: this.resolve(pair.value), line });
    }

    const provider = seen.get('provider');
    if (provider !== undefined) {
      const name = this.string(provider.value);
      if (name === null) this.problem(provider.line, `reviewer.provider takes a string, not ${describe(provider.value)}`);
      else if ((PROVIDERS as readonly string[]).includes(name)) config.provider = name as ProviderName;
      else if (LATER_PROVIDERS.includes(name)) {
        this.problem(provider.line, `the provider '${name}' is not in this version; it has ${PROVIDERS.join(', ')}`);
      } else {
        const near = nearestKey(name, [...PROVIDERS]);
        this.problem(provider.line, `the provider '${name}' is unknown${near === null ? '' : ` (did you mean '${near}'?)`}; this version has ${PROVIDERS.join(', ')}`);
      }
    }

    const model = seen.get('model');
    if (model !== undefined) {
      const text = this.string(model.value);
      if (text === null || text.trim() === '' || /[\r\n]/.test(text)) {
        this.problem(model.line, `reviewer.model takes a non-empty string without a line break, not ${describe(model.value)}`);
      } else {
        config.model = text;
      }
    } else if (config.provider === 'openai-compatible' || config.provider === 'anthropic') {
      this.problem(reviewerLine, `the provider '${config.provider}' needs reviewer.model`);
    }

    const isClaude = config.provider === 'claude-code';
    if (isClaude) {
      config.timeout = 300;
      config.parallel = 1;
      config.temperature = null;
    }
    this.integer(seen.get('timeout'), 'timeout', 1, 86400, 'an integer of seconds from 1 to 86400', (n) => (config.timeout = n));
    this.integer(seen.get('max_chars'), 'max_chars', 1, Infinity, 'an integer of at least 1', (n) => (config.maxChars = n));
    this.integer(seen.get('parallel'), 'parallel', 1, Infinity, 'an integer of at least 1', (n) => (config.parallel = n));
    this.integer(seen.get('max_calls'), 'max_calls', 0, Infinity, 'an integer of at least 0', (n) => (config.maxCalls = n));

    const temperature = seen.get('temperature');
    if (temperature !== undefined) {
      if (isClaude) {
        this.problem(temperature.line, 'the provider claude-code takes no temperature: the claude program runs at its own');
      } else {
        const value = this.number(temperature.value);
        if (value === null || value < 0) this.problem(temperature.line, `reviewer.temperature takes a number of at least 0, not ${describe(temperature.value)}`);
        else config.temperature = value;
      }
    }
  }

  private integer(
    entry: { value: YamlNode | null; line: number } | undefined,
    key: string,
    min: number,
    max: number,
    what: string,
    set: (value: number) => void,
  ): void {
    if (entry === undefined) return;
    const value = this.number(entry.value);
    if (value === null || !Number.isInteger(value) || value < min || value > max) {
      this.problem(entry.line, `reviewer.${key} takes ${what}, not ${describe(entry.value)}`);
      return;
    }
    set(value);
  }

  private number(value: YamlNode | null): number | null {
    return isScalar(value) && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null;
  }

  private string(value: YamlNode | null): string | null {
    return isScalar(value) && typeof value.value === 'string' ? value.value : null;
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
    this.problems.push({ line, message });
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
