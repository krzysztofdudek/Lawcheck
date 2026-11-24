import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument, visit } from 'yaml';
import type { Document, Node as YamlNode, Pair, YAMLMap } from 'yaml';
import { LAW_RULES, LAW_TYPES } from './limits.js';
import { step } from './progress.js';
import { compileList, compilePattern, patternProblem } from './glob.js';
import { CODES } from './output.js';

export type Status = 'enforced' | 'advisory';

export interface ContextItem {
  path: string;
  line: number;
}

export interface Rule {
  id: string;
  why: string;
  status: Status;
  line: number;
  context: ContextItem[] | null;
  contextLine: number | null;
  companion: ContextItem | null;
}

export interface TypeDef {
  id: string;
  about: string | null;
  paths: string[];
  matches: (path: string) => boolean;
  content: RegExp | null;
  expression: string | null;
  rules: string[];
  types: TypeDef[];
  parent: TypeDef | null;
  line: number;
  mayUse: string[] | null;
  waivers: boolean | null;
}

export interface Folders {
  patterns: string[];
  matches: (path: string) => boolean;
}

export interface Law {
  rules: Map<string, Rule>;
  types: TypeDef[];
  byId: Map<string, TypeDef>;
  required: Folders;
  ignored: Folders;
  signers: Map<string, string> | null;
}

export interface LawProblem {
  line: number;
  message: string;
  tooLarge?: boolean;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const TOP_KEYS = ['lawcheck', 'required', 'ignored', 'rules', 'types', 'signers'];
const RULE_KEYS = ['why', 'status', 'context', 'companion'];
const TYPE_KEYS = ['about', 'paths', 'content', 'rules', 'types', 'may_use', 'waivers'];
// 32 bytes in base64url without padding: the last of the 43 characters carries 4 bits and two zero bits, so one spelling per key.
export const KEY_TEXT = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

export function nearestKey(key: string, known: string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of known) {
    const d = distance(key, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

// The YAML library finds a repeated key by comparing it with every key before it, which takes minutes for a law of 200,000 rules; a set finds the same keys in one pass.
export function parseUnique(text: string, counter: LineCounter): { doc: Document; errors: { pos: number; message: string }[] } {
  const doc = parseDocument(text, { lineCounter: counter, prettyErrors: false, uniqueKeys: false });
  const errors = doc.errors.map((error) => ({ pos: error.pos[0], message: error.message }));
  visit(doc, {
    Map(_, map) {
      const seen = new Set<unknown>();
      for (const pair of map.items) {
        if (!isScalar(pair.key)) continue;
        if (seen.has(pair.key.value)) errors.push({ pos: pair.key.range?.[0] ?? 0, message: 'Map keys must be unique' });
        seen.add(pair.key.value);
      }
    },
  });
  errors.sort((a, b) => a.pos - b.pos);
  return { doc, errors };
}

export function parseLaw(text: string): { law: Law | null; problems: LawProblem[] } {
  step('reading the law');
  const counter = new LineCounter();
  const { doc, errors } = parseUnique(text, counter);
  const problems: LawProblem[] = [];
  if (errors.length > 0) {
    for (const error of errors) {
      const line = counter.linePos(error.pos).line;
      problems.push({ line, message: `the law does not parse: ${error.message.split('\n')[0]}` });
    }
    return { law: null, problems };
  }
  return new Reader(doc, counter, problems).read();
}

function typeCount(types: YAMLMap): number {
  let count = 0;
  for (const pair of types.items) {
    count++;
    const below = isMap(pair.value) ? pair.value.get('types', true) : undefined;
    if (isMap(below)) count += typeCount(below);
  }
  return count;
}

const NO_FOLDERS: Folders = { patterns: [], matches: () => false };

// The first plain pattern of the list that takes the path, to name in a message.
export function patternFor(folders: Folders, path: string): string | null {
  if (!folders.matches(path)) return null;
  return folders.patterns.find((pattern) => !pattern.startsWith('!') && compilePattern(pattern).test(path)) ?? null;
}

class Reader {
  private readonly rules = new Map<string, Rule>();
  private readonly byId = new Map<string, TypeDef>();
  private readonly listed: { owner: string; rule: string; line: number }[] = [];
  private readonly used: { owner: string; type: string; line: number }[] = [];
  private readonly reportedKeys = new Set<Pair>();
  private readonly open = new Set<unknown>();

  constructor(
    private readonly doc: Document,
    private readonly counter: LineCounter,
    private readonly problems: LawProblem[],
  ) {}

  read(): { law: Law | null; problems: LawProblem[] } {
    const top = this.resolve(this.doc.contents);
    if (top === null || (isScalar(top) && (top.value === null || top.value === ''))) {
      this.problem(1, 'the law is empty');
      return { law: null, problems: this.problems };
    }
    if (!isMap(top)) {
      this.problem(this.lineOf(top), 'the law is not a mapping');
      return { law: null, problems: this.problems };
    }
    let types: TypeDef[] = [];
    let required = NO_FOLDERS;
    let ignored = NO_FOLDERS;
    let signers: Map<string, string> | null = null;
    let sawVersion = false;
    for (const pair of top.items) {
      const key = this.keyOf(pair);
      const value = this.resolve(pair.value);
      const line = this.lineOf(pair.key);
      if (key === 'lawcheck') {
        sawVersion = true;
        const version = this.string(value, line, "'lawcheck'");
        if (version !== null && !VERSION.test(version)) this.problem(line, `'lawcheck' is '${version}'; it takes MAJOR.MINOR.PATCH`);
      } else if (key === 'required') {
        required = this.folders(value, line, "'required'") ?? NO_FOLDERS;
      } else if (key === 'ignored') {
        ignored = this.folders(value, line, "'ignored'") ?? NO_FOLDERS;
      } else if (key === 'rules') {
        if (!this.mapping(value, line, "'rules'")) continue;
        const count = (value as YAMLMap).items.length;
        if (count > LAW_RULES) {
          this.problems.push({ line, message: `the law holds ${count.toLocaleString('en-US')} rules, more than the ${LAW_RULES.toLocaleString('en-US')} a law may hold`, tooLarge: true });
          return { law: null, problems: this.problems };
        }
        this.readRules(value as YAMLMap);
      } else if (key === 'types') {
        if (!this.mapping(value, line, "'types'")) continue;
        const count = typeCount(value as YAMLMap);
        if (count > LAW_TYPES) {
          this.problems.push({ line, message: `the law holds ${count.toLocaleString('en-US')} types, more than the ${LAW_TYPES.toLocaleString('en-US')} a law may hold`, tooLarge: true });
          return { law: null, problems: this.problems };
        }
        types = this.readTypes(value as YAMLMap, null);
      } else if (key === 'signers') {
        signers = this.readSigners(value, line);
      } else {
        this.unknown(key, TOP_KEYS, line, 'at the top of the law');
      }
    }
    if (!sawVersion) this.problem(1, "the law has no key 'lawcheck'");
    for (const { owner, rule, line } of this.listed) {
      if (!this.rules.has(rule)) this.problem(line, `type '${owner}' lists the rule '${rule}', which the law does not have`);
    }
    for (const { owner, type, line } of this.used) {
      if (!this.byId.has(type)) this.problem(line, `'may_use' of type '${owner}' names '${type}', which is no type of the law`);
    }
    if (this.problems.length > 0) return { law: null, problems: this.problems };
    return { law: { rules: this.rules, types, byId: this.byId, required, ignored, signers }, problems: [] };
  }

  private readSigners(value: YamlNode | null, line: number): Map<string, string> | null {
    if (!this.mapping(value, line, "'signers'")) return null;
    const map = value as YAMLMap;
    if (map.items.length === 0) {
      this.problem(line, "'signers' names no signer");
      return null;
    }
    const signers = new Map<string, string>();
    for (const pair of map.items) {
      const name = this.keyOf(pair);
      const at = this.lineOf(pair.key);
      if (!ID.test(name)) this.problem(at, `the signer name '${name}' is not kebab-case`);
      const key = this.string(this.resolve(pair.value), at, `the key of signer '${name}'`);
      if (key === null) continue;
      if (KEY_TEXT.test(key)) signers.set(name, key);
      else this.problem(at, `the key of signer '${name}' is no Ed25519 public key: it takes 43 characters of base64url`);
    }
    return signers;
  }

  private readRules(map: YAMLMap): void {
    for (const pair of map.items) {
      const id = this.keyOf(pair);
      const line = this.lineOf(pair.key);
      if (!ID.test(id)) this.problem(line, `the rule id '${id}' is not kebab-case`);
      else if (CODES.has(id)) this.problem(line, `the rule id '${id}' is a code of Lawcheck`);
      const value = this.resolve(pair.value);
      if (!this.mapping(value, line, `rule '${id}'`)) continue;
      let why: string | null = null;
      let status: Status = 'enforced';
      let context: ContextItem[] | null = null;
      let contextLine: number | null = null;
      let companion: ContextItem | null = null;
      for (const field of (value as YAMLMap).items) {
        const key = this.keyOf(field);
        const fieldLine = this.lineOf(field.key);
        const fieldValue = this.resolve(field.value);
        if (key === 'why') {
          why = this.line(fieldValue, fieldLine, `'why' of rule '${id}'`);
          if (why !== null && [...why].length > 200) this.problem(fieldLine, `'why' of rule '${id}' is longer than 200 characters`);
        } else if (key === 'status') {
          const text = this.string(fieldValue, fieldLine, `'status' of rule '${id}'`);
          if (text === 'enforced' || text === 'advisory') status = text;
          else if (text !== null) this.problem(fieldLine, `'status' of rule '${id}' is '${text}'; it takes 'enforced' or 'advisory'`);
        } else if (key === 'context') {
          contextLine = fieldLine;
          context = this.paths(fieldValue, fieldLine, `'context' of rule '${id}'`);
        } else if (key === 'companion') {
          const path = this.string(fieldValue, fieldLine, `'companion' of rule '${id}'`);
          if (path !== null) companion = { path, line: fieldLine };
        } else {
          this.unknown(key, RULE_KEYS, fieldLine, `in rule '${id}'`);
        }
      }
      if (!(value as YAMLMap).items.some((field) => this.keyOf(field) === 'why')) this.problem(line, `rule '${id}' has no 'why'`);
      this.rules.set(id, { id, why: why ?? '', status, line, context, contextLine, companion });
    }
  }

  private readTypes(map: YAMLMap, parent: TypeDef | null): TypeDef[] {
    const out: TypeDef[] = [];
    for (const pair of map.items) {
      const id = this.keyOf(pair);
      const line = this.lineOf(pair.key);
      if (!ID.test(id)) this.problem(line, `the type id '${id}' is not kebab-case`);
      else if (this.byId.has(id)) this.problem(line, `the type id '${id}' appears twice in the law`);
      const value = this.resolve(pair.value);
      if (!this.mapping(value, line, `type '${id}'`)) continue;
      if (this.open.has(value)) {
        this.problem(line, `type '${id}' is, through an alias, a type that holds it`);
        continue;
      }
      const type: TypeDef = { id, about: null, paths: [], matches: () => false, content: null, expression: null, rules: [], types: [], parent, line, mayUse: null, waivers: null };
      if (!this.byId.has(id)) this.byId.set(id, type);
      let sawPaths = false;
      for (const field of (value as YAMLMap).items) {
        const key = this.keyOf(field);
        const fieldLine = this.lineOf(field.key);
        const fieldValue = this.resolve(field.value);
        if (key === 'about') {
          type.about = this.line(fieldValue, fieldLine, `'about' of type '${id}'`);
        } else if (key === 'paths') {
          sawPaths = true;
          const patterns = this.strings(fieldValue, fieldLine, `'paths' of type '${id}'`);
          if (patterns === null) continue;
          let valid = true;
          for (const { text, line: itemLine } of patterns) {
            const problem = patternProblem(text);
            if (problem !== null) {
              valid = false;
              this.problem(itemLine, `the pattern '${text}' of type '${id}' ${problem}`);
            }
          }
          if (!patterns.some(({ text }) => !text.startsWith('!'))) {
            valid = false;
            this.problem(fieldLine, `'paths' of type '${id}' holds no pattern without '!'`);
          }
          if (valid) {
            type.paths = patterns.map(({ text }) => text);
            type.matches = compileList(type.paths);
          }
        } else if (key === 'content') {
          const text = this.string(fieldValue, fieldLine, `'content' of type '${id}'`);
          if (text === null) continue;
          try {
            type.content = new RegExp(text, 'm');
            type.expression = text;
          } catch (error) {
            this.problem(fieldLine, `'content' of type '${id}' is no valid expression: ${firstLine(error)}`);
          }
        } else if (key === 'rules') {
          const ids = this.strings(fieldValue, fieldLine, `'rules' of type '${id}'`);
          if (ids === null) continue;
          for (const { text, line: itemLine } of ids) {
            this.listed.push({ owner: id, rule: text, line: itemLine });
            if (!type.rules.includes(text)) type.rules.push(text);
          }
        } else if (key === 'may_use') {
          const ids = this.strings(fieldValue, fieldLine, `'may_use' of type '${id}'`);
          if (ids === null) continue;
          type.mayUse = [];
          for (const { text, line: itemLine } of ids) {
            this.used.push({ owner: id, type: text, line: itemLine });
            if (!type.mayUse.includes(text)) type.mayUse.push(text);
          }
        } else if (key === 'waivers') {
          if (isScalar(fieldValue) && typeof fieldValue.value === 'boolean') type.waivers = fieldValue.value;
          else this.problem(fieldLine, `'waivers' of type '${id}' takes true or false, not ${describe(fieldValue)}`);
        } else if (key === 'types') {
          if (this.mapping(fieldValue, fieldLine, `'types' of type '${id}'`)) {
            this.open.add(value);
            type.types = this.readTypes(fieldValue as YAMLMap, type);
            this.open.delete(value);
          }
        } else {
          this.unknown(key, TYPE_KEYS, fieldLine, `in type '${id}'`);
        }
      }
      if (!sawPaths) this.problem(line, `type '${id}' has no 'paths'`);
      out.push(type);
    }
    return out;
  }

  private folders(value: YamlNode | null, line: number, what: string): Folders | null {
    const patterns = this.strings(value, line, what);
    if (patterns === null) return null;
    let valid = true;
    for (const { text, line: itemLine } of patterns) {
      const problem = patternProblem(text);
      if (problem !== null) {
        valid = false;
        this.problem(itemLine, `the pattern '${text}' of ${what} ${problem}`);
      }
    }
    if (patterns.length > 0 && !patterns.some(({ text }) => !text.startsWith('!'))) {
      valid = false;
      this.problem(line, `${what} holds no pattern without '!'`);
    }
    if (!valid) return null;
    const list = patterns.map(({ text }) => text);
    return { patterns: list, matches: list.length === 0 ? () => false : compileList(list) };
  }

  private resolve(node: unknown): YamlNode | null {
    let current = node;
    for (let depth = 0; isAlias(current) && depth < 100; depth++) current = current.resolve(this.doc) ?? null;
    return (current ?? null) as YamlNode | null;
  }

  private keyOf(pair: Pair): string {
    const key = this.resolve(pair.key);
    if (isScalar(key) && typeof key.value === 'string') return key.value;
    const text = isScalar(key) ? (key.source ?? String(key.value)) : String(key);
    if (!this.reportedKeys.has(pair)) {
      this.reportedKeys.add(pair);
      this.problem(this.lineOf(pair.key), `the key '${text}' is no string; write it in quotes`);
    }
    return text;
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

  private mapping(value: YamlNode | null, line: number, what: string): boolean {
    if (isMap(value)) return true;
    this.problem(line, `${what} takes a mapping, not ${describe(value)}`);
    return false;
  }

  private string(value: YamlNode | null, line: number, what: string): string | null {
    if (isScalar(value) && typeof value.value === 'string') return value.value;
    this.problem(line, `${what} takes a string, not ${describe(value)}`);
    return null;
  }

  private line(value: YamlNode | null, line: number, what: string): string | null {
    const text = this.string(value, line, what);
    if (text === null) return null;
    if (text.trim() === '') {
      this.problem(line, `${what} is empty`);
      return null;
    }
    if (/[\r\n]/.test(text)) {
      this.problem(line, `${what} holds a line break`);
      return null;
    }
    return text;
  }

  private paths(value: YamlNode | null, line: number, what: string): ContextItem[] | null {
    const items = isSeq(value) ? value.items.map((item) => this.resolve(item)) : null;
    if (items === null || items.some((node) => !(isScalar(node) && typeof node.value === 'string'))) {
      this.problem(line, `${what} takes a sequence of paths, not ${isSeq(value) ? 'a sequence with an item that is no string' : describe(value)}`);
      return null;
    }
    return items.map((node) => ({ path: (node as { value: string }).value, line: this.lineOf(node) }));
  }

  private strings(value: YamlNode | null, line: number, what: string): { text: string; line: number }[] | null {
    if (!isSeq(value)) {
      this.problem(line, `${what} takes a sequence of strings, not ${describe(value)}`);
      return null;
    }
    const out: { text: string; line: number }[] = [];
    let valid = true;
    for (const item of value.items) {
      const node = this.resolve(item);
      const itemLine = node ? this.lineOf(node) : line;
      if (isScalar(node) && typeof node.value === 'string') out.push({ text: node.value, line: itemLine });
      else {
        valid = false;
        this.problem(itemLine, `${what} takes a sequence of strings, and one item is ${describe(node)}`);
      }
    }
    return valid ? out : null;
  }
}

function describe(value: YamlNode | null): string {
  if (value === null) return 'nothing';
  if (isMap(value)) return 'a mapping';
  if (isSeq(value)) return 'a sequence';
  if (isScalar(value)) {
    const v = value.value;
    if (v === null) return 'nothing';
    if (typeof v === 'string') return 'a string';
    if (typeof v === 'number' || typeof v === 'bigint') return 'a number';
    if (typeof v === 'boolean') return 'a boolean';
  }
  return 'another kind of value';
}

// A type without the key takes its parent's value, and a root type without it reads waivers.
export function takesWaivers(type: TypeDef | null): boolean {
  for (let at = type; at !== null; at = at.parent) if (at.waivers !== null) return at.waivers;
  return true;
}

export function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split(/\r?\n/)[0] ?? '';
}
