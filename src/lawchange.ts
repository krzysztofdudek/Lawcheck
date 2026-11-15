import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.js';
import { git, mergeBase, resolveCommit, splitZ } from './files.js';
import { parseLaw } from './law.js';
import type { Law, TypeDef } from './law.js';
import { LAW, RULES_DIR } from './setup.js';

export const LINE_ITEMS = 5;

function blobAt(root: string, commit: string, path: string): Buffer | null {
  const result = git(root, ['show', `${commit}:./${path}`]);
  return result.status === 0 ? result.stdout : null;
}

function treeAt(root: string, commit: string): Map<string, string> {
  const result = git(root, ['ls-tree', '-r', '-z', commit, '--', RULES_DIR.slice(0, -1)]);
  const found = new Map<string, string>();
  if (result.status !== 0) return found;
  let start = 0;
  const text = result.stdout;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== 0) continue;
    const entry = text.subarray(start, i);
    start = i + 1;
    const tab = entry.indexOf(9);
    if (tab < 0) continue;
    const [, , id] = entry.subarray(0, tab).toString('latin1').split(' ');
    const paths = splitZ(Buffer.concat([entry.subarray(tab + 1), Buffer.from([0])]));
    if (id !== undefined && paths[0] !== undefined) found.set(paths[0], id);
  }
  return found;
}

function blobById(root: string, id: string): Buffer | null {
  const result = git(root, ['cat-file', 'blob', id]);
  return result.status === 0 ? result.stdout : null;
}

const UNSAFE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

export function named(path: string): string {
  return path.replace(UNSAFE, (c) => {
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
  for (const id of sorted(is.keys())) {
    const old = was.get(id);
    const now = is.get(id)!;
    if (old === undefined) continue;
    for (const rule of old.rules) if (!now.rules.includes(rule) && after.rules.has(rule)) items.push(`takes the rule ${rule} off the type ${id}`);
    for (const rule of now.rules) if (!old.rules.includes(rule) && before.rules.has(rule)) items.push(`puts the rule ${rule} on the type ${id}`);
    if (!same(old.paths, now.paths)) items.push(`changes the paths of the type ${id}`);
    if (old.content?.source !== now.content?.source) items.push(`changes the content of the type ${id}`);
    if (!same(old.mayUse, now.mayUse)) items.push(`changes may_use of the type ${id}`);
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
export function lawChanges(root: string, base: string, files: string[], changed: Set<string>): string[] {
  const commit = resolveCommit(root, base);
  const fork = commit === null ? null : mergeBase(root, commit);
  if (fork === null) return [];
  const items: string[] = [];
  const lawBefore = blobAt(root, fork, LAW);
  const lawAfter = fileNow(root, LAW);
  if (lawBefore !== null && lawAfter !== null && !lawBefore.equals(lawAfter)) {
    const before = lawOf(lawBefore);
    const after = lawOf(lawAfter);
    const told = before !== null && after !== null ? ofLaw(before, after) : [];
    items.push(...(told.length > 0 ? told : [before !== null && after !== null ? `edits ${LAW} without changing a rule or a type` : `changes ${LAW}`]));
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
  return items;
}

export function lawChangeLine(items: string[]): string {
  const shown = items.slice(0, LINE_ITEMS).join('; ');
  const rest = items.length - LINE_ITEMS;
  return `note: this change edits the law that judges it: ${shown}${rest > 0 ? `; and ${rest} more` : ''}`;
}
