import { lstatSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG, LOCAL_CONFIG } from './config.js';
import type { ReviewerConfig } from './config.js';
import { comparePaths, git, mergeBase, resolveCommit, splitZ } from './files.js';
import { keyEnvironment } from './keys.js';
import { CONFIG_BYTES, count, LAW_BYTES, mib } from './limits.js';
import { bytesOfName } from './names.js';
import { parseLaw, takesWaivers } from './law.js';
import type { Law, TypeDef } from './law.js';
import type { ErrorItem } from './output.js';
import { guardedFolder, releaseFolder } from './programs.js';
import { createProvider } from './providers/index.js';
import { configErrors, LAW, RULES_DIR, ruleKinds, Stop, touchesLaw } from './setup.js';
import type { Kinds, Read } from './setup.js';
import { decode } from './types.js';
import { allows, listInForce } from './uses.js';
import { LOCAL, Unwritable } from './verdicts.js';

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
    if (!same(old.mayUse, now.mayUse)) items.push(widened(old, now, was, is) ?? `changes may_use of the type ${id}`);
    if (old.about !== now.about) items.push(`changes the about of the type ${id}`);
    if (old.waivers !== now.waivers) items.push(!takesWaivers(old) && takesWaivers(now) ? `reads waivers in the type ${id}` : `changes the waivers of the type ${id}`);
  }
  return items;
}

// The lists in force are compared, so a type that drops its own list is read by the list it then takes from above. A type that the old list reached through a type above it, in either law, is not new: when it moved in the same change, its own item names the move.
function widened(old: TypeDef, now: TypeDef, before: Map<string, TypeDef>, after: Map<string, TypeDef>): string | null {
  const was = listInForce(old)?.list;
  const is = listInForce(now)?.list;
  if (was === undefined) return null;
  if (is === undefined) return `widens may_use of the type ${now.id} to any file`;
  const reached = (target: TypeDef | undefined) => target !== undefined && allows(was, target);
  const more = is.filter((id) => !reached(before.get(id)) && !reached(after.get(id)));
  return more.length > 0 ? `widens may_use of the type ${now.id} by ${more.join(', ')}` : null;
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

const SAYS_LOOSENS = /^(?:removes the (?:rule|type|signer) |widens may_use of the type |reads waivers in the type |adds the signer |changes the key of the signer |makes the rule \S+ advisory$|takes the rule \S+ off the type |adds (?!!).* to ignored$|adds !.* to required$|takes (?!!).* off required$|takes !.* off ignored$)/;
const MAY_LOOSEN = /^(?:changes the (?:paths|content) of the type |moves the type |(?:changes|removes) \.lawcheck\/(?:law\.yaml$|rules\/))/;
// A type added under another may carry a may_use or waivers of its own, which its files take in place of the parent's.
const ADDED_TYPE = /^adds the type /;
const LOOSENS = [SAYS_LOOSENS, MAY_LOOSEN, ADDED_TYPE];

function rank(item: string): number {
  const at = LOOSENS.findIndex((pattern) => pattern.test(item));
  return at < 0 ? LOOSENS.length : at;
}

// The line shows five items, so past five they go in the order of LOOSENS. An item whose words name no direction may loosen the law, and it goes after those whose words do, so that it never pushes one of them into the count.
export function lawChangeLine(items: string[], lead = 'this change edits the law that judges it'): string {
  const ordered = items.length > LINE_ITEMS ? [...items].sort((a, b) => rank(a) - rank(b)) : items;
  const shown = ordered.slice(0, LINE_ITEMS).join('; ');
  const rest = items.length - LINE_ITEMS;
  return `note: ${lead}: ${shown}${rest > 0 ? `; and ${rest} more` : ''}`;
}

export interface LawAt {
  ref: string;
  law: Law;
  config: ReviewerConfig;
  // The files of the law at the commit, by their path from the root; null is a symbolic link, which Lawcheck reads no rule through.
  files: Map<string, Buffer | null>;
  // The commit's package.json and .lawcheck/package.json, when they are files.
  manifests: Map<string, Buffer>;
}

const FILE_MODES = new Set(['100644', '100755']);
const LAW_FROM_NEXT = `pass --law-from with a commit here that holds ${LAW}, such as the base of the change`;

function unreachableLaw(message: string): Stop {
  return new Stop([{ code: 'law-from-unreachable', file: null, line: null, message, next: LAW_FROM_NEXT }]);
}

const MANIFESTS = ['package.json', '.lawcheck/package.json'];

function lawEntries(root: string, commit: string, paths = [LAW, CONFIG, RULES_DIR.slice(0, -1)]): Map<string, { mode: string; type: string; id: string }> {
  const result = git(root, ['ls-tree', '-r', '-z', commit, '--', ...paths]);
  const found = new Map<string, { mode: string; type: string; id: string }>();
  if (result.status !== 0) return found;
  for (const entry of splitZ(result.stdout)) {
    const tab = entry.indexOf('\t');
    const [mode, type, id] = entry.slice(0, tab).split(' ');
    if (tab > 0 && mode !== undefined && type !== undefined && id !== undefined) found.set(entry.slice(tab + 1), { mode, type, id });
  }
  return found;
}

export function lawAt(root: string, ref: string): LawAt {
  const said = `, in the law of '${ref}' that --law-from names`;
  const commit = resolveCommit(root, ref);
  if (commit === null) throw unreachableLaw(`the ref '${ref}' that --law-from names is no commit here`);
  const entries = lawEntries(root, commit);
  const regular = [...entries].filter(([, entry]) => entry.type === 'blob' && FILE_MODES.has(entry.mode)).map(([path]) => path);
  if (!regular.includes(LAW)) throw unreachableLaw(`the commit '${ref}' that --law-from names holds no ${LAW}`);
  const blobs = blobsAt(root, commit, regular);
  const lawBytes = blobs.get(LAW) ?? Buffer.alloc(0);
  if (lawBytes.length > LAW_BYTES) throw new Stop([{ code: 'file-too-large', file: LAW, line: 1, message: `the law holds ${count(lawBytes.length)} bytes, more than the ${mib(LAW_BYTES)} a law may hold${said}` }]);
  const parsed = parseLaw(decode(lawBytes));
  if (parsed.law === null) throw new Stop(parsed.problems.map((p): ErrorItem => ({ code: p.tooLarge ? 'file-too-large' : 'law-invalid', file: LAW, line: p.line, message: `${p.message}${said}` })));
  const configBytes = blobs.get(CONFIG);
  if (configBytes != null && configBytes.length > CONFIG_BYTES) throw new Stop([{ code: 'file-too-large', file: CONFIG, line: null, message: `the file holds ${count(configBytes.length)} bytes, more than the ${mib(CONFIG_BYTES)} the config may hold${said}` }]);
  // The variables and config.local.yaml are this machine's, not the change's, so they stand over the commit's config.yaml as over the one on disk.
  const configured = configErrors(root, { text: configBytes == null ? null : decode(configBytes), said });
  if ('errors' in configured) throw new Stop(configured.errors);
  const config = configured.config;
  const files = new Map<string, Buffer | null>();
  for (const [path, entry] of entries) {
    if (entry.mode === '120000') files.set(path, null);
    else if (blobs.get(path) != null) files.set(path, blobs.get(path)!);
  }
  const manifests = new Map<string, Buffer>();
  const manifestFiles = [...lawEntries(root, commit, MANIFESTS)].filter(([path, entry]) => MANIFESTS.includes(path) && entry.type === 'blob' && FILE_MODES.has(entry.mode)).map(([path]) => path);
  for (const [path, bytes] of blobsAt(root, commit, manifestFiles)) if (bytes !== null) manifests.set(path, bytes);
  return { ref, law: parsed.law, config, files, manifests };
}

// What the law of the commit binds is judged on the work tree, so its rule files and the law's own files come from the commit and every other file from the work tree.
export function kindsAt(at: LawAt, workFiles: string[], read: Read): { files: string[]; read: Read; kinds: Kinds } {
  const files = [...workFiles.filter((path) => !touchesLaw(path)), ...[...at.files].filter(([, bytes]) => bytes !== null).map(([path]) => path)].sort();
  const readAt: Read = (path) => {
    if (!touchesLaw(path)) return read(path);
    const bytes = at.files.get(path);
    if (bytes == null) throw Object.assign(new Error(`no file ${path} at ${at.ref}`), { code: 'ENOENT' });
    return bytes;
  };
  const kinds = ruleKinds(at.law, files, readAt, (path) => at.files.get(path) === null);
  const said = `, in the law of '${at.ref}' that --law-from names`;
  if (kinds.errors.length > 0) throw new Stop(kinds.errors.map((error) => ({ ...error, message: `${error.message}${said}` })));
  return { files, read: readAt, kinds };
}

const PACKAGE_FOLDERS = ['.lawcheck/node_modules', LOCAL];

// HFS+ skips these code points when it compares names, by Apple's Technical Note TN1150, the same list git skips when it guards .git on macOS.
const HFS_IGNORED = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g;

// A rule loaded from the copy in .lawcheck/.local finds a package it imports by name in the node_modules folders above that copy, so the change may hold none of them. Git keeps the case of a path, and a file system that ignores case finds it all the same: macOS finds .lawcheck/node_moduleſ, with a long s, as .lawcheck/node_modules, and only toUpperCase turns that s into an S.
export function packagesOfChange(listed: Iterable<string>, ref: string): void {
  const known = (folder: string) => PACKAGE_FOLDERS.indexOf(folder.replace(HFS_IGNORED, '').toUpperCase().toLowerCase());
  const found = new Map<string, string[]>();
  for (const path of listed) {
    const folder = path.split('/').slice(0, 2).join('/');
    if (known(folder) >= 0) found.set(folder, [...(found.get(folder) ?? []), path]);
  }
  const errors = [...found.keys()].sort((a, b) => known(a) - known(b) || comparePaths(a, b)).map((folder): ErrorItem => {
    const [first, ...rest] = found.get(folder)!.sort(comparePaths);
    const more = rest.length === 0 ? '' : `, and ${count(rest.length)} more file${rest.length === 1 ? '' : 's'} there`;
    return { code: 'law-from-packages', file: first!, line: null, message: `git lists this file in ${folder}${more}, and a package that a rule of '${ref}' imports cannot come from the change`, next: `take ${folder} out of git, such as with git rm -r --cached ${folder}, and name it in .gitignore` };
  });
  if (errors.length > 0) throw new Stop(errors);
}

// Under --law-from, config.local.yaml is this machine's and stands over the commit's config.yaml, so the change may bring none. The one git tracks under its own name is refused wherever the config is read. Git keeps the case of a path, and a file system that ignores case reads .lawcheck/Config.Local.yaml as that file all the same. Git also lists a submodule or a link at .lawcheck as one path and tracks no file inside it.
export function localConfigOfChange(root: string, listed: Iterable<string>): void {
  const stop = (file: string, message: string, next: string): never => {
    throw new Stop([{ code: 'config-invalid', file, line: null, message, next }]);
  };
  for (const path of listed) {
    const name = path.replace(HFS_IGNORED, '').toUpperCase().toLowerCase();
    if (name === '.lawcheck' && lstatSync(join(root, LOCAL_CONFIG), { throwIfNoEntry: false }) !== undefined) {
      stop(LOCAL_CONFIG, `this file lies in ${path}, which git lists as a link or a repository of its own, and the settings of one machine cannot come from the change`, `ask the user to remove ${LOCAL_CONFIG}, or to make .lawcheck a folder of this repository, then run lawcheck check`);
    }
    if (name === LOCAL_CONFIG && path !== LOCAL_CONFIG && git(root, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', path]).status === 0) {
      stop(path, `git tracks this file, which a file system that ignores case reads as ${LOCAL_CONFIG}, and the settings of one machine cannot come from the change`, `ask the user to take ${path} out of git, such as with git rm --cached ${path}, then run lawcheck check`);
    }
  }
}

const SAFE_PART = /^(?!\.{1,2}$)[^/\\]+$/;

// A rule is loaded from a copy of the commit's .lawcheck/rules/ below the root, where the runner may read, so its imports of ./lib/ find the commit's helpers. The copy holds a .gitignore of its own, so git never lists it, and the guard removes it if the tool is killed.
// Node resolves an import whose name is the name of the nearest package.json through that file's exports, and one that starts with # through its imports, before any node_modules, so the copy holds the commit's package.json, or an empty one, and its .lawcheck/package.json, and the work tree's are never the nearest.
export function writeRules(root: string, at: LawAt): { folder: string; release(): void } {
  const local = join(root, LOCAL);
  const cannot = (cause: string) => new Unwritable(LOCAL, cause);
  let made = false;
  try {
    const top = lstatSync(join(root, '.lawcheck'));
    if (!top.isDirectory()) throw cannot('.lawcheck is no folder');
    mkdirSync(local, { recursive: false });
    made = true;
  } catch (error) {
    if (error instanceof Unwritable) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw cannot((error as NodeJS.ErrnoException).code ?? 'an error');
  }
  if (!lstatSync(local).isDirectory()) throw cannot('it is no folder');
  let folder: string;
  try {
    folder = guardedFolder('law-from-', local);
  } catch (error) {
    throw cannot((error as NodeJS.ErrnoException).code ?? 'an error');
  }
  try {
    writeFileSync(join(folder, '.gitignore'), '*\n');
    writeFileSync(join(folder, 'package.json'), at.manifests.get('package.json') ?? '{}\n');
    const own = at.manifests.get('.lawcheck/package.json');
    if (own !== undefined) {
      mkdirSync(join(folder, '.lawcheck'), { recursive: true });
      writeFileSync(join(folder, '.lawcheck/package.json'), own);
    }
    for (const [path, bytes] of at.files) {
      if (bytes === null || !path.startsWith(RULES_DIR) || !path.split('/').every((part) => SAFE_PART.test(part))) continue;
      const target = join(folder, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
  } catch (error) {
    release();
    throw cannot((error as NodeJS.ErrnoException).code ?? 'an error');
  }
  return { folder, release };

  function release(): void {
    releaseFolder(folder);
    if (!made) return;
    try {
      rmdirSync(local);
    } catch {
      // The reader cache may have written into the folder during the run, and then it stays.
    }
  }
}

