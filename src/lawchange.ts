import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.js';
import { git, mergeBase, resolveCommit, splitZ } from './files.js';
import { bytesOfName } from './names.js';
import { parseLaw } from './law.js';
import type { Law, TypeDef } from './law.js';
import { LAW, RULES_DIR } from './setup.js';

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
  items.push(...ofFolders('required', before.required.patterns, after.required.patterns));
  items.push(...ofFolders('ignored', before.ignored.patterns, after.ignored.patterns));
  items.push(...ofSigners(before.signers ?? new Map(), after.signers ?? new Map()));
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
    if (old.companion?.path !== now.companion?.path) items.push(`changes the companion of the rule ${id}`);
  }
  for (const id of sorted(is.keys())) {
    const old = was.get(id);
    const now = is.get(id)!;
    if (old === undefined) continue;
    const from = old.parent?.id ?? null;
    const to = now.parent?.id ?? null;
    if (from !== to) items.push(`moves the type ${id} from ${from ?? 'the top of types'} to ${to ?? 'the top of types'}`);
    for (const rule of old.rules) if (!now.rules.includes(rule) && after.rules.has(rule)) items.push(`takes the rule ${rule} off the type ${id}`);
    for (const rule of now.rules) if (!old.rules.includes(rule) && before.rules.has(rule)) items.push(`puts the rule ${rule} on the type ${id}`);
    if (!same(old.paths, now.paths)) items.push(`changes the paths of the type ${id}`);
    if (old.content?.source !== now.content?.source) items.push(`changes the content of the type ${id}`);
    if (!same(old.mayUse, now.mayUse)) items.push(`changes may_use of the type ${id}`);
    if (old.about !== now.about) items.push(`changes the about of the type ${id}`);
    if (old.waivers !== now.waivers) items.push(`changes the waivers of the type ${id}`);
  }
  return items;
}

function ofSigners(before: Map<string, string>, after: Map<string, string>): string[] {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  return names.flatMap((name) => {
    const was = before.get(name);
    const is = after.get(name);
    if (was === undefined) return [`adds the signer ${name}`];
    if (is === undefined) return [`removes the signer ${name}`];
    return was === is ? [] : [`changes the key of the signer ${name}`];
  });
}

function ofFolders(key: string, before: string[], after: string[]): string[] {
  const items = [...after.filter((pattern) => !before.includes(pattern)).map((pattern) => `adds ${named(pattern)} to ${key}`), ...before.filter((pattern) => !after.includes(pattern)).map((pattern) => `takes ${named(pattern)} off ${key}`)];
  return items.length === 0 && !same(before, after) ? [`changes ${key}`] : items;
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
  const fork = forkOf(root, base);
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
  return items;
}

function forkOf(root: string, base: string): string | null {
  const commit = resolveCommit(root, base);
  return commit === null ? null : mergeBase(root, commit);
}

const HEADER = /^[0-9a-f]{40}(?:[0-9a-f]{24})? (\S+) (\d+)$/;

// One cat-file reads every path, where two processes for each path cost a few milliseconds a file. cat-file reads one name a line and drops a carriage return before the line break, so a path with either is read alone.
function blobsAt(root: string, commit: string, paths: string[]): Map<string, Buffer | null> {
  const out = new Map<string, Buffer | null>();
  const batch: { path: string; bytes: Buffer }[] = [];
  for (const path of paths) {
    const bytes = bytesOfName(path);
    if (bytes.includes(0x0a) || bytes.includes(0x0d)) out.set(path, blobAt(root, commit, path));
    else batch.push({ path, bytes });
  }
  if (batch.length === 0) return out;
  const result = git(root, ['cat-file', '--batch'], {}, Buffer.concat(batch.flatMap(({ bytes }) => [Buffer.from(`${commit}:./`), bytes, Buffer.from('\n')])));
  const read = result.stdout;
  let at = 0;
  for (const { path } of batch) {
    const end = result.status === 0 ? read.indexOf(0x0a, at) : -1;
    if (end < 0) {
      out.set(path, blobAt(root, commit, path));
      continue;
    }
    const header = HEADER.exec(read.subarray(at, end).toString('latin1'));
    at = end + 1;
    if (header === null) {
      out.set(path, null);
      continue;
    }
    const size = Number(header[2]);
    out.set(path, header[1] === 'blob' ? read.subarray(at, at + size) : null);
    at += size + 1;
  }
  return out;
}

export function atBase(root: string, base: string): ((paths: string[]) => Map<string, Buffer | null>) | null {
  const fork = forkOf(root, base);
  return fork === null ? null : (paths) => blobsAt(root, fork, paths);
}

const LOOSENS = /^(?:removes the (?:rule|type|signer) |adds the signer |changes the key of the signer |makes the rule \S+ advisory$|takes the rule \S+ off the type |adds .* to ignored$|takes .* off required$)/;

// The line shows five items, so past five the items that loosen the law go first and are never left in the count.
export function lawChangeLine(items: string[]): string {
  const ordered = items.length > LINE_ITEMS ? [...items.filter((item) => LOOSENS.test(item)), ...items.filter((item) => !LOOSENS.test(item))] : items;
  const shown = ordered.slice(0, LINE_ITEMS).join('; ');
  const rest = items.length - LINE_ITEMS;
  return `note: this change edits the law that judges it: ${shown}${rest > 0 ? `; and ${rest} more` : ''}`;
}
