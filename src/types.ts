import { onDisk } from './names.js';
import type { Law, TypeDef } from './law.js';
import type { ErrorItem } from './output.js';
import { readBounded, readError, startsBinary, TextTooLarge } from './limits.js';
import { step } from './progress.js';

export interface TypedFile {
  path: string;
  type: TypeDef;
  rules: string[];
  text: string;
  lines: string[];
}

// The lines are split again on each use, so a run holds the text of a file once.
class LinedFile implements TypedFile {
  constructor(
    readonly path: string,
    readonly type: TypeDef,
    readonly rules: string[],
    readonly text: string,
  ) {}

  get lines(): string[] {
    return splitLines(this.text);
  }
}

const decoder = new TextDecoder('utf-8');

export function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function anyPathMatch(path: string, types: TypeDef[]): boolean {
  return types.some((type) => type.matches(path) || anyPathMatch(path, type.types));
}

function names(types: TypeDef[]): string {
  const quoted = types.map((type) => `'${type.id}'`);
  return quoted.length === 2 ? `${quoted[0]} and ${quoted[1]}` : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

export function typeFiles(
  root: string,
  paths: string[],
  law: Law,
  read: (path: string) => Uint8Array = (path) => readBounded(onDisk(root, path), path).bytes,
  binaryAt: (path: string) => boolean = (path) => startsBinary(onDisk(root, path)),
): { typed: TypedFile[]; untyped: string[]; unreadable: ErrorItem[]; overlaps: ErrorItem[] } {
  const typed: TypedFile[] = [];
  const untyped: string[] = [];
  const unreadable: ErrorItem[] = [];
  const overlaps: ErrorItem[] = [];
  for (const path of paths) {
    step(`typing ${path}`);
    if (law.ignored.matches(path)) continue;
    const required = law.required.matches(path);
    if (!anyPathMatch(path, law.types)) {
      if (required && isText(path, binaryAt)) untyped.push(path);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = read(path);
    } catch (error) {
      unreadable.push(readError(path, error));
      if (error instanceof TextTooLarge) break;
      continue;
    }
    if (isBinary(bytes)) continue;
    const text = decode(bytes);
    const chain: TypeDef[] = [];
    let overlapped = false;
    let level = law.types;
    for (;;) {
      const hits = level.filter((type) => type.matches(path) && (type.content === null || type.content.test(text)));
      if (hits.length > 1) {
        overlaps.push({ code: 'type-overlap', file: path, line: null, message: `the file matches the types ${names(hits)} of one level` });
        chain.length = 0;
        overlapped = true;
        break;
      }
      if (hits.length === 0) break;
      chain.push(hits[0]!);
      level = hits[0]!.types;
    }
    if (chain.length === 0) {
      if (required && !overlapped) untyped.push(path);
      continue;
    }
    const rules: string[] = [];
    for (const type of chain) for (const rule of type.rules) if (!rules.includes(rule)) rules.push(rule);
    typed.push(new LinedFile(path, chain[chain.length - 1]!, rules, text));
  }
  return { typed, untyped, unreadable, overlaps };
}

// A file whose first bytes cannot be read is named as untyped rather than passed over in silence.
function isText(path: string, binaryAt: (path: string) => boolean): boolean {
  try {
    return !binaryAt(path);
  } catch {
    return true;
  }
}

export function filesOfTypes(typed: TypedFile[], law: Law): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of law.byId.keys()) out.set(id, []);
  for (const file of typed) {
    for (let type: TypeDef | null = file.type; type !== null; type = type.parent) out.get(type.id)?.push(file.path);
  }
  for (const list of out.values()) list.sort();
  return out;
}
