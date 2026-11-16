import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.js';
import { git, mergeBase, resolveCommit, splitZ } from './files.js';
import { parseLaw } from './law.js';
import type { Law, TypeDef } from './law.js';
import { LAW, RULES_DIR } from './setup.js';
import { decode, isBinary, splitLines } from './types.js';
import { MARKER, parseWaivers } from './waivers.js';

export const LINE_ITEMS = 5;

function parseEntries(output: Buffer): Map<string, string> {
  const found = new Map<string, string>();
  let start = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] !== 0) continue;
    const entry = output.subarray(start, i);
    start = i + 1;
    const tab = entry.indexOf(9);
    if (tab < 0) continue;
    const [, , id] = entry.subarray(0, tab).toString('latin1').split(' ');
    const paths = splitZ(Buffer.concat([entry.subarray(tab + 1), Buffer.from([0])]));
    if (id !== undefined && paths[0] !== undefined) found.set(paths[0], id);
  }
  return found;
}

function blobAt(root: string, commit: string, path: string): Buffer | null {
  const listed = git(root, ['--literal-pathspecs', 'ls-tree', '-z', commit, '--', path]);
  const id = listed.status === 0 ? parseEntries(listed.stdout).get(path) : undefined;
  return id === undefined ? null : blobById(root, id);
}

function treeAt(root: string, commit: string): Map<string, string> {
  const result = git(root, ['ls-tree', '-r', '-z', commit, '--', RULES_DIR.slice(0, -1)]);
  return result.status === 0 ? parseEntries(result.stdout) : new Map();
}

function blobById(root: string, id: string): Buffer | null {
  const result = git(root, ['cat-file', 'blob', id]);
  return result.status === 0 ? result.stdout : null;
}

const UNSAFE = /[\\\p{Cc}\p{Cf}\u2028\u2029]/gu;

export function named(path: string): string {
  return path.replace(UNSAFE, (c) => {
    if (c === '\\') return '\\\\';
    const code = c.codePointAt(0)!;
    if (code === 0x200c || code === 0x200d) return c;
    return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, '0')}`;
  });
}

function fileNow(root: string, path: string): Buffer | null {
  try {
    return readFileSync(join(root, path));
  } catch {
    return null;
  }
}

function lawOf(bytes: Buffer): Law | null {
  return parseLaw(bytes.toString('utf8')).law;
}

function flat(law: Law): Map<string, TypeDef> {
  return new Map(law.byId);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ofLaw(before: Law, after: Law): string[] {
  const items: string[] = [];
  const was = flat(before);
  const is = flat(after);
  const sorted = (ids: Iterable<string>) => [...ids].sort();
  for (const id of sorted(was.keys())) if (!is.has(id)) items.push(`removes the type ${id}`);
  for (const id of sorted(is.keys())) if (!was.has(id)) items.push(`adds the type ${id}`);
  for (const id of sorted(before.rules.keys())) if (!after.rules.has(id)) items.push(`removes the rule ${id}`);
  for (const id of sorted(after.rules.keys())) if (!before.rules.has(id)) items.push(`adds the rule ${id}`);
  for (const id of sorted(after.rules.keys())) {
    const old = before.rules.get(id);
    const now = after.rules.get(id)!;
    if (old !== undefined && old.status !== now.status) items.push(`makes the rule ${id} ${now.status}`);
  }
  for (const id of sorted(after.rules.keys())) {
    const old = before.rules.get(id);
    const now = after.rules.get(id)!;
    if (old === undefined) continue;
    if (old.why !== now.why) items.push(`changes the why of the rule ${id}`);
    if (!same(old.context?.map((c) => c.path), now.context?.map((c) => c.path))) items.push(`changes the context of the rule ${id}`);
  }
  for (const id of sorted(is.keys())) {
    const old = was.get(id);
    const now = is.get(id)!;
    if (old === undefined) continue;
    for (const rule of old.rules) if (!now.rules.includes(rule) && after.rules.has(rule)) items.push(`takes the rule ${rule} off the type ${id}`);
    for (const rule of now.rules) if (!old.rules.includes(rule) && before.rules.has(rule)) items.push(`puts the rule ${rule} on the type ${id}`);
    if (!same(old.paths, now.paths)) items.push(`changes the paths of the type ${id}`);
    if (old.content?.source !== now.content?.source) items.push(`changes the content of the type ${id}`);
    if (!same(old.mayUse, now.mayUse)) items.push(`changes may_use of the type ${id}`);
    if (old.about !== now.about) items.push(`changes the about of the type ${id}`);
  }
  return items;
}

function ofFile(path: string, before: Buffer | null, after: Buffer | null): string | null {
  if (before === null && after === null) return null;
  const shown = named(path);
  if (before === null) return `adds ${shown}`;
  if (after === null) return `removes ${shown}`;
  return before.equals(after) ? null : `changes ${shown}`;
}

// What the change does to the law that judges it, read against the merge base of HEAD and the base. A file that cannot be told apart in words is named, so the list is never empty when the law changed.
export function lawChanges(root: string, base: string, files: string[], changed: Set<string>, plain: Set<string>): string[] {
  const commit = resolveCommit(root, base);
  const fork = commit === null ? null : mergeBase(root, commit);
  if (fork === null) return [];
  const items: string[] = [];
  const lawBefore = blobAt(root, fork, LAW);
  const lawAfter = fileNow(root, LAW);
  const lawsBefore = lawBefore === null ? null : lawOf(lawBefore);
  const lawsAfter = lawAfter === null ? null : lawOf(lawAfter);
  if (lawBefore !== null && lawAfter !== null && !lawBefore.equals(lawAfter)) {
    const told = lawsBefore !== null && lawsAfter !== null ? ofLaw(lawsBefore, lawsAfter) : [];
    items.push(...(told.length > 0 ? told : [lawsBefore !== null && lawsAfter !== null ? `edits ${LAW} without changing a rule or a type` : `changes ${LAW}`]));
  } else {
    const item = ofFile(LAW, lawBefore, lawAfter);
    if (item !== null) items.push(item);
  }
  const here = new Set(files);
  const before = treeAt(root, fork);
  const names = new Set([...before.keys()].filter((path) => !here.has(path)));
  for (const path of changed) if (path.startsWith(RULES_DIR)) names.add(path);
  for (const path of [...names].sort()) {
    const id = before.get(path);
    const item = ofFile(path, id === undefined ? null : blobById(root, id), fileNow(root, path));
    if (item !== null) items.push(item);
  }
  const config = ofFile(CONFIG, blobAt(root, fork, CONFIG), fileNow(root, CONFIG));
  if (config !== null) items.push(config);
  items.push(...waiversAdded(root, fork, changed, new Set([...(lawsBefore?.rules.keys() ?? []), ...(lawsAfter?.rules.keys() ?? [])]), plain));
  return items;
}

function waiversOf(bytes: Buffer | null, rules: Set<string>): Map<string, number> {
  const counts = new Map<string, number>();
  if (bytes === null || isBinary(bytes)) return counts;
  for (const waiver of parseWaivers(splitLines(decode(bytes)), rules).waivers) {
    const key = `${waiver.rule}\u0000${waiver.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function waiversAdded(root: string, fork: string, changed: Set<string>, rules: Set<string>, plain: Set<string>): string[] {
  const items: string[] = [];
  for (const path of [...changed].sort()) {
    if (path.startsWith(RULES_DIR) || plain.has(path)) continue;
    const now = fileNow(root, path);
    if (now === null || !now.includes(MARKER)) continue;
    const before = waiversOf(blobAt(root, fork, path), rules);
    const seen = new Map<string, number>();
    for (const [key, count] of waiversOf(now, rules)) {
      const added = count - (before.get(key) ?? 0);
      if (added > 0) seen.set(key.split('\u0000')[0]!, (seen.get(key.split('\u0000')[0]!) ?? 0) + added);
    }
    for (const rule of [...seen.keys()].sort()) items.push(`adds a waiver of ${rule} in ${named(path)}`);
  }
  return items;
}

export function lawChangeLine(items: string[]): string {
  const shown = items.slice(0, LINE_ITEMS).join('; ');
  const rest = items.length - LINE_ITEMS;
  return `note: this change edits the law that judges it: ${shown}${rest > 0 ? `; and ${rest} more` : ''}`;
}
