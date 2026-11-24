import type { TypeDef } from './law.js';
import { plural } from './output.js';
import type { Unresolved } from './output.js';
import type { Use } from './readers.js';

export interface InForce {
  list: string[];
  from: TypeDef;
}

export function listInForce(type: TypeDef): InForce | null {
  for (let at: TypeDef | null = type; at !== null; at = at.parent) {
    if (at.mayUse !== null) return { list: at.mayUse, from: at };
  }
  return null;
}

export function allows(list: string[], target: TypeDef): boolean {
  for (let at: TypeDef | null = target; at !== null; at = at.parent) if (list.includes(at.id)) return true;
  return false;
}

function listPart(type: TypeDef, inForce: InForce): string {
  const list = `[${inForce.list.join(', ')}]`;
  return inForce.from === type ? `its may_use is ${list}` : `it takes may_use ${list} from ${inForce.from.id}`;
}

export type Target = { kind: 'typed'; type: TypeDef } | { kind: 'untyped' } | { kind: 'binary' };

export function forbiddenMessage(type: TypeDef, inForce: InForce, file: string, target: Target): string {
  if (target.kind === 'typed') return `${type.id} may not use ${target.type.id} (${file}); ${listPart(type, inForce)}`;
  return `${type.id} may not use ${file}, which has no type; ${listPart(type, inForce)}`;
}

const CANDIDATES_SHOWN = 3;

function ambiguousMessage(type: TypeDef, inForce: InForce, what: string, candidates: { file: string; target: Target }[]): string {
  const named = candidates.map(({ file, target }) => `${file} (${target.kind === 'typed' ? target.type.id : 'no type'})`);
  const shown = named.length > CANDIDATES_SHOWN ? `${named.slice(0, CANDIDATES_SHOWN).join(', ')} and ${named.length - CANDIDATES_SHOWN} more` : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `${type.id} may not use ${what}, which names one of ${shown}; ${listPart(type, inForce)}`;
}

// Whichever candidate the use names, the list forbids it, so the finding rests on no guess.
function everyForbidden(path: string, list: string[], candidates: string[], targetOf: (file: string) => Target): { file: string; target: Target }[] | null {
  if (candidates.length === 0) return null;
  const out: { file: string; target: Target }[] = [];
  for (const file of candidates) {
    if (file === path) return null;
    const target = targetOf(file);
    if (target.kind === 'binary' || (target.kind === 'typed' && allows(list, target.type))) return null;
    out.push({ file, target });
  }
  return out;
}

export interface Forbidden {
  file: string;
  line: number;
  message: string;
}

export interface Judged {
  forbidden: Forbidden[];
  unresolved: Omit<Unresolved, 'debt'>[];
}

export function judgeUses(path: string, type: TypeDef, uses: Use[], targetOf: (file: string) => Target): Judged {
  const inForce = listInForce(type);
  const out: Judged = { forbidden: [], unresolved: [] };
  if (inForce === null) return out;
  const seen = new Set<string>();
  for (const { line, answer } of uses) {
    if (answer.kind === 'outside') continue;
    if (answer.kind !== 'file') {
      const reason = answer.kind === 'none' ? answer.reason : null;
      out.unresolved.push({ file: path, line, what: answer.what, answer: answer.kind, reason, candidates: answer.candidates });
      const forbidden = answer.kind === 'ambiguous' ? everyForbidden(path, inForce.list, answer.candidates, targetOf) : null;
      const key = `${line}\0\0${answer.what}`;
      if (forbidden === null || seen.has(key)) continue;
      seen.add(key);
      out.forbidden.push({ file: path, line, message: ambiguousMessage(type, inForce, answer.what, forbidden) });
      continue;
    }
    if (answer.file === path) continue;
    const target = targetOf(answer.file);
    if (target.kind === 'binary') continue;
    if (target.kind === 'typed' && allows(inForce.list, target.type)) continue;
    const key = `${line}\0${answer.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.forbidden.push({ file: path, line, message: forbiddenMessage(type, inForce, answer.file, target) });
  }
  return out;
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : 'no extension';
}

export function notReadMessage(type: string, paths: string[]): string {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const extension = extensionOf(path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  const parts = [...counts.keys()].sort().map((extension) => `${counts.get(extension)} ${extension}`);
  const files = plural(paths.length, 'file');
  return `${files} of type ${type} ${paths.length === 1 ? 'is' : 'are'} not read for uses: ${parts.join(', ')}`;
}

export interface NotRead {
  type: TypeDef;
  debt: boolean;
  message: string;
}

export function notRead(unread: { path: string; type: TypeDef; debt: boolean }[]): NotRead[] {
  const groups = new Map<string, { type: TypeDef; debt: boolean; paths: string[] }>();
  for (const { path, type, debt } of unread) {
    const key = `${debt}\0${type.id}`;
    let group = groups.get(key);
    if (group === undefined) groups.set(key, (group = { type, debt, paths: [] }));
    group.paths.push(path);
  }
  return [...groups.values()].map(({ type, debt, paths }) => ({ type, debt, message: notReadMessage(type.id, paths) }));
}

export function mayUsePart(type: TypeDef, gap = ' '): string | null {
  const inForce = listInForce(type);
  if (inForce === null) return null;
  const list = inForce.list.length === 0 ? 'nothing' : inForce.list.join(', ');
  return inForce.from === type ? list : `${list}${gap}(from ${inForce.from.id})`;
}
