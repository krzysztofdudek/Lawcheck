import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import type { Document, Node as YamlNode, Pair, YAMLMap } from 'yaml';
import { compileList, patternProblem } from './glob.js';
import { CODES } from './output.js';

export type Status = 'enforced' | 'advisory';

export interface Rule {
  id: string;
  why: string;
  status: Status;
  line: number;
}

export interface TypeDef {
  id: string;
  paths: string[];
  matches: (path: string) => boolean;
  content: RegExp | null;
  rules: string[];
  types: TypeDef[];
  parent: TypeDef | null;
}

export interface Law {
  rules: Map<string, Rule>;
  types: TypeDef[];
  byId: Map<string, TypeDef>;
}

export interface LawProblem {
  line: number;
  message: string;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const TOP_KEYS = ['lawcheck', 'rules', 'types'];
const RULE_KEYS = ['why', 'status'];
const TYPE_KEYS = ['about', 'paths', 'content', 'rules', 'types'];
const RESERVED = new Set([...CODES, 'untyped-file']);

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

export function parseLaw(text: string): { law: Law | null; problems: LawProblem[] } {
  const counter = new LineCounter();
  const doc = parseDocument(text, { lineCounter: counter, prettyErrors: false, uniqueKeys: true });
  const problems: LawProblem[] = [];
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      const line = counter.linePos(error.pos[0]).line;
      problems.push({ line, message: `the law does not parse: ${error.message.split('\n')[0]}` });
    }
    return { law: null, problems };
  }
  return new Reader(doc, counter, problems).read();
}

class Reader {
  private readonly rules = new Map<string, Rule>();
  private readonly byId = new Map<string, TypeDef>();
  private readonly listed: { owner: string; rule: string; line: number }[] = [];
  private readonly reportedKeys = new Set<Pair>();

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
    let sawVersion = false;
    for (const pair of top.items) {
      const key = this.keyOf(pair);
      const value = this.resolve(pair.value);
      const line = this.lineOf(pair.key);
      if (key === 'lawcheck') {
        sawVersion = true;
        const version = this.string(value, line, "'lawcheck'");
        if (version !== null && !VERSION.test(version)) this.problem(line, `'lawcheck' is '${version}'; it takes MAJOR.MINOR.PATCH`);
      } else if (key === 'rules') {
        if (this.mapping(value, line, "'rules'")) this.readRules(value as YAMLMap);
      } else if (key === 'types') {
        if (this.mapping(value, line, "'types'")) types = this.readTypes(value as YAMLMap, null);
      } else {
        this.unknown(key, TOP_KEYS, line, 'at the top of the law');
      }
    }
    if (!sawVersion) this.problem(1, "the law has no key 'lawcheck'");
    for (const { owner, rule, line } of this.listed) {
      if (!this.rules.has(rule)) this.problem(line, `type '${owner}' lists the rule '${rule}', which the law does not have`);
    }
    if (this.problems.length > 0) return { law: null, problems: this.problems };
    return { law: { rules: this.rules, types, byId: this.byId }, problems: [] };
  }

  private readRules(map: YAMLMap): void {
    for (const pair of map.items) {
      const id = this.keyOf(pair);
      const line = this.lineOf(pair.key);
      if (!ID.test(id)) this.problem(line, `the rule id '${id}' is not kebab-case`);
      else if (RESERVED.has(id)) this.problem(line, `the rule id '${id}' is a code of Lawcheck`);
      const value = this.resolve(pair.value);
      if (!this.mapping(value, line, `rule '${id}'`)) continue;
      let why: string | null = null;
      let status: Status = 'enforced';
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
        } else {
          this.unknown(key, RULE_KEYS, fieldLine, `in rule '${id}'`);
        }
      }
      if (!(value as YAMLMap).items.some((field) => this.keyOf(field) === 'why')) this.problem(line, `rule '${id}' has no 'why'`);
      this.rules.set(id, { id, why: why ?? '', status, line });
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
      const type: TypeDef = { id, paths: [], matches: () => false, content: null, rules: [], types: [], parent };
      if (!this.byId.has(id)) this.byId.set(id, type);
      let sawPaths = false;
      for (const field of (value as YAMLMap).items) {
        const key = this.keyOf(field);
        const fieldLine = this.lineOf(field.key);
        const fieldValue = this.resolve(field.value);
        if (key === 'about') {
          this.line(fieldValue, fieldLine, `'about' of type '${id}'`);
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
        } else if (key === 'types') {
          if (this.mapping(fieldValue, fieldLine, `'types' of type '${id}'`)) type.types = this.readTypes(fieldValue as YAMLMap, type);
        } else {
          this.unknown(key, TYPE_KEYS, fieldLine, `in type '${id}'`);
        }
      }
      if (!sawPaths) this.problem(line, `type '${id}' has no 'paths'`);
      out.push(type);
    }
    return out;
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

export function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split(/\r?\n/)[0] ?? '';
}
