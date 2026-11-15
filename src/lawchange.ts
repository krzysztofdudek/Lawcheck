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

function treeAt(root: string, commit: string): string[] {
  const result = git(root, ['ls-tree', '-r', '-z', '--name-only', commit, '--', RULES_DIR.slice(0, -1)]);
  return result.status === 0 ? splitZ(result.stdout) : [];
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
  if (before === null) return `adds ${path}`;
  if (after === null) return `removes ${path}`;
  return before.equals(after) ? null : `changes ${path}`;
}

// What the change does to the law that judges it, read against the merge base of HEAD and the base. A file that cannot be told apart in words is named, so the list is never empty when the law changed.
export function lawChanges(root: string, base: string, files: string[]): string[] {
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
  const names = new Set([...treeAt(root, fork), ...files.filter((path) => path.startsWith(RULES_DIR))]);
  for (const path of [...names].sort()) {
    const item = ofFile(path, blobAt(root, fork, path), fileNow(root, path));
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
